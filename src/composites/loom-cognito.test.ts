import { describe, test, expect } from "vitest";
import { expandComposite } from "@intentius/chant";
import { resolveAttrRefs } from "@intentius/chant/discovery/resolve";
import { awsSerializer } from "@intentius/chant-lexicon-aws";
import { LoomCognito, LOOM_COGNITO_SCOPES, LOOM_UI_TIER_GROUPS, type LoomCognitoProps } from "./loom-cognito";
import type { LoomNamingParams } from "../lib/naming";

const lightNaming: LoomNamingParams = {
  project: "loom",
  env: "test",
  instance: "a",
  tier: "light",
  region: "us-east-1",
  accountId: "111111111111",
  owner: "platform",
};

const prodNaming: LoomNamingParams = { ...lightNaming, tier: "production" };
const prodHaNaming: LoomNamingParams = { ...lightNaming, tier: "production-ha" };

function baseProvisionProps(overrides: Partial<LoomCognitoProps> = {}): LoomCognitoProps {
  return {
    naming: lightNaming,
    identity: { mode: "provision" },
    ...overrides,
  };
}

describe("LoomCognito — provision, light tier", () => {
  test("returns only the core members — no user client, branding, or groups", () => {
    const instance = LoomCognito(baseProvisionProps());
    const names = Object.keys(instance.members);
    for (const expected of ["userPool", "userPoolDomain", "resourceServer", "m2mClient"]) {
      expect(names).toContain(expected);
    }
    for (const absent of ["userClient", "managedLoginBranding", "uiTierGroup0", "uiTierGroup1"]) {
      expect(names).not.toContain(absent);
    }
  });

  test("scope catalog is trimmed to just invoke (matches Loom's own pScopes default)", () => {
    const instance = LoomCognito(baseProvisionProps());
    const props = (instance.resourceServer as any).props;
    expect(props.Scopes).toHaveLength(1);
    expect((props.Scopes[0] as any).props.ScopeName).toBe("invoke");
  });

  test("MFA off, advanced security AUDIT, deletion protection INACTIVE", () => {
    const instance = LoomCognito(baseProvisionProps());
    const props = (instance.userPool as any).props;
    expect(props.MfaConfiguration).toBe("OFF");
    expect(props.EnabledMfas).toBeUndefined();
    expect((props.UserPoolAddOns as any).props.AdvancedSecurityMode).toBe("AUDIT");
    expect(props.DeletionProtection).toBe("INACTIVE");
  });

  test("M2M client only requests client_credentials + the invoke scope — never implicit", () => {
    const instance = LoomCognito(baseProvisionProps());
    const props = (instance.m2mClient as any).props;
    expect(props.AllowedOAuthFlows).toEqual(["client_credentials"]);
    expect(props.AllowedOAuthFlows).not.toContain("implicit");
    expect(props.GenerateSecret).toBe(true);
  });

  test("identity.mode defaults to \"provision\" when omitted entirely", () => {
    const instance = LoomCognito({ naming: lightNaming, identity: {} });
    expect(Object.keys(instance.members)).toContain("userPool");
  });
});

describe("LoomCognito — provision, production tier", () => {
  function prodProps(overrides: Partial<LoomCognitoProps> = {}): LoomCognitoProps {
    return { naming: prodNaming, identity: { mode: "provision" }, ...overrides };
  }

  test("adds user client, Managed Login branding, and the default UI-tier groups", () => {
    const instance = LoomCognito(prodProps());
    const names = Object.keys(instance.members);
    for (const expected of ["userClient", "managedLoginBranding", "uiTierGroup0", "uiTierGroup1"]) {
      expect(names).toContain(expected);
    }
    expect(names).not.toContain("resourceGroup0");
  });

  test("full 23-scope catalog on the resource server", () => {
    const instance = LoomCognito(prodProps());
    const props = (instance.resourceServer as any).props;
    expect(props.Scopes).toHaveLength(23);
    expect(props.Scopes).toHaveLength(LOOM_COGNITO_SCOPES.length);
  });

  test("user client never allows implicit grant, requests OIDC + all domain scopes", () => {
    const instance = LoomCognito(prodProps());
    const props = (instance.userClient as any).props;
    expect(props.AllowedOAuthFlows).toEqual(["code"]);
    expect(props.AllowedOAuthFlows).not.toContain("implicit");
    expect(props.AllowedOAuthScopes).toEqual(expect.arrayContaining(["openid", "email", "profile"]));
    expect(props.AllowedOAuthScopes.length).toBe(3 + 23);
  });

  test("MFA on (software token) and advanced security ENFORCED", () => {
    const instance = LoomCognito(prodProps());
    const props = (instance.userPool as any).props;
    expect(props.MfaConfiguration).toBe("ON");
    expect(props.EnabledMfas).toEqual(["SOFTWARE_TOKEN_MFA"]);
    expect((props.UserPoolAddOns as any).props.AdvancedSecurityMode).toBe("ENFORCED");
  });

  test("still no deletion protection at plain production", () => {
    const instance = LoomCognito(prodProps());
    expect((instance.userPool as any).props.DeletionProtection).toBe("INACTIVE");
  });

  test("Managed Login branding targets the user client", () => {
    const instance = LoomCognito(prodProps());
    const brandingProps = (instance.managedLoginBranding as any).props;
    expect((brandingProps.ClientId as any).target).toBe(instance.userClient);
    expect(brandingProps.UseCognitoProvidedValues).toBe(true);
  });

  test("managedLoginBranding: false skips the branding member", () => {
    const instance = LoomCognito(prodProps({ identity: { mode: "provision", managedLoginBranding: false } }));
    expect(Object.keys(instance.members)).not.toContain("managedLoginBranding");
  });

  test("custom resourceGroups (a team's real org structure) are built as additional groups", () => {
    const instance = LoomCognito(prodProps({
      identity: {
        mode: "provision",
        groups: { resourceGroups: [{ name: "g-team-a", description: "Team A resources" }, { name: "g-team-b" }] },
      },
    }));
    const names = Object.keys(instance.members);
    expect(names).toContain("resourceGroup0");
    expect(names).toContain("resourceGroup1");
    const group0Props = ((instance.members as any).resourceGroup0 as any).props;
    expect(group0Props.GroupName).toBe("g-team-a");
  });

  test("resourceGroups default to empty — no Loom demo groups defaulted in", () => {
    const instance = LoomCognito(prodProps());
    const names = Object.keys(instance.members);
    const resourceGroupNames = names.filter((n) => n.startsWith("resourceGroup"));
    expect(resourceGroupNames).toHaveLength(0);
  });
});

describe("LoomCognito — production-ha tier", () => {
  test("deletion protection is ACTIVE", () => {
    const instance = LoomCognito({ naming: prodHaNaming, identity: { mode: "provision" } });
    expect((instance.userPool as any).props.DeletionProtection).toBe("ACTIVE");
  });
});

describe("LoomCognito — demo seed (chant#888: opt-in only)", () => {
  function prodPropsWithSeed(users: any[]): LoomCognitoProps {
    return {
      naming: prodNaming,
      identity: {
        mode: "provision",
        groups: { resourceGroups: [{ name: "g-team-a" }] },
        demoSeed: { users },
      },
    };
  }

  test("no demoSeed -> no user/attachment members at all", () => {
    const instance = LoomCognito({ naming: prodNaming, identity: { mode: "provision" } });
    const names = Object.keys(instance.members);
    expect(names.some((n) => n.startsWith("demoUser"))).toBe(false);
  });

  test("opting in builds a user + its uiTier attachment + each resourceGroup attachment", () => {
    const instance = LoomCognito(prodPropsWithSeed([
      { username: "admin", email: "admin@example.com", uiTier: "t-admin", resourceGroups: ["g-team-a"] },
    ]));
    const names = Object.keys(instance.members);
    expect(names).toContain("demoUser0");
    expect(names).toContain("demoUserTierAttachment0");
    expect(names).toContain("demoUserResourceAttachment0_0");

    const members = instance.members as any;
    const userProps = (members.demoUser0 as any).props;
    expect(userProps.Username).toBe("admin");
    expect(userProps.UserAttributes[0].props.Value).toBe("admin@example.com");

    const tierAttachmentProps = (members.demoUserTierAttachment0 as any).props;
    expect((tierAttachmentProps.Username as any).target).toBe(members.demoUser0);
    expect((tierAttachmentProps.GroupName as any).target).toBe(members.uiTierGroup0);
  });

  test("demoSeed on light tier is ignored — no groups exist there to attach to", () => {
    const instance = LoomCognito({
      naming: lightNaming,
      identity: { mode: "provision", demoSeed: { users: [{ username: "admin", email: "a@example.com", uiTier: "t-admin" }] } },
    });
    const names = Object.keys(instance.members);
    expect(names.some((n) => n.startsWith("demoUser"))).toBe(false);
  });

  test("throws on a demoSeed user referencing an unknown uiTier group", () => {
    expect(() =>
      LoomCognito(prodPropsWithSeed([{ username: "ghost", email: "g@example.com", uiTier: "t-nonexistent" }])),
    ).toThrow(/unknown uiTier group/);
  });

  test("throws on a demoSeed user referencing an unknown resource group", () => {
    expect(() =>
      LoomCognito(prodPropsWithSeed([
        { username: "ghost", email: "g@example.com", uiTier: "t-admin", resourceGroups: ["g-does-not-exist"] },
      ])),
    ).toThrow(/unknown resource group/);
  });
});

describe("LoomCognito — BYO-identity (chant#898): reference-existing | omit", () => {
  test("reference-existing produces no members — the composite tracks nothing of its own", () => {
    const instance = LoomCognito({
      naming: lightNaming,
      identity: {
        mode: "reference-existing",
        userPoolId: "us-east-1_ABC123",
        domain: "loom-shared",
        resourceServerIdentifier: "loom-agentcore",
        m2mClientId: "m2m-client-id",
      },
    });
    expect(Object.keys(instance.members)).toHaveLength(0);
  });

  test("omit produces no members — the identity tier is dropped entirely", () => {
    const instance = LoomCognito({ naming: lightNaming, identity: { mode: "omit" } });
    expect(Object.keys(instance.members)).toHaveLength(0);
  });
});

describe("LoomCognito — naming, tags, and ABAC", () => {
  test("physical names derive from the naming helper, not literals", () => {
    const instance = LoomCognito(baseProvisionProps());
    const poolProps = (instance.userPool as any).props;
    expect(poolProps.UserPoolName).toBe("loom-test-a-loom-cognito-pool");
    const domainProps = (instance.userPoolDomain as any).props;
    expect(typeof domainProps.Domain).toBe("string");
    expect(domainProps.Domain.length).toBeLessThanOrEqual(63);
  });

  test("UserPoolTags carries both cost-allocation tags and the loom:* ABAC tags", () => {
    const instance = LoomCognito(baseProvisionProps());
    const poolProps = (instance.userPool as any).props;
    expect(poolProps.UserPoolTags).toMatchObject({
      component: "loom-cognito",
      env: "test",
      instance: "a",
      "loom:application": "loom",
      "loom:group": "a",
      "loom:owner": "platform",
    });
  });

  test("abacTags overrides win over the naming-derived defaults", () => {
    const instance = LoomCognito(baseProvisionProps({
      identity: { mode: "provision", abacTags: { group: "custom-tenant" } },
    }));
    const poolProps = (instance.userPool as any).props;
    expect(poolProps.UserPoolTags["loom:group"]).toBe("custom-tenant");
  });

  test("UI-tier group names default to Loom's own t-admin/t-user pair", () => {
    const instance = LoomCognito({ naming: prodNaming, identity: { mode: "provision" } });
    const members = instance.members as any;
    const group0 = (members.uiTierGroup0 as any).props;
    const group1 = (members.uiTierGroup1 as any).props;
    expect([group0.GroupName, group1.GroupName].sort()).toEqual(
      LOOM_UI_TIER_GROUPS.map((g) => g.name).sort(),
    );
  });
});

describe("LoomCognito — serializes to valid CloudFormation", () => {
  test("light tier: template has Resources for every member, no dangling refs", () => {
    const instance = LoomCognito(baseProvisionProps());
    const expanded = expandComposite("loomCognito", instance);
    resolveAttrRefs(expanded);
    const output = awsSerializer.serialize(expanded) as string;
    const template = JSON.parse(output);

    expect(template.AWSTemplateFormatVersion).toBe("2010-09-09");
    expect(Object.keys(template.Resources)).toHaveLength(expanded.size);
    for (const resource of Object.values(template.Resources) as any[]) {
      expect(typeof resource.Type).toBe("string");
      expect(resource.Type.startsWith("AWS::")).toBe(true);
    }
    expect(template.Resources.loomCognitoUserPool.Type).toBe("AWS::Cognito::UserPool");
    expect(template.Resources.loomCognitoM2mClient.Type).toBe("AWS::Cognito::UserPoolClient");
  });

  test("production tier: template includes the user client, groups, and branding and stays internally consistent", () => {
    const instance = LoomCognito({ naming: prodNaming, identity: { mode: "provision" } });
    const expanded = expandComposite("loomCognito", instance);
    resolveAttrRefs(expanded);
    const output = awsSerializer.serialize(expanded) as string;
    const template = JSON.parse(output);

    expect(template.Resources.loomCognitoUserClient.Type).toBe("AWS::Cognito::UserPoolClient");
    expect(template.Resources.loomCognitoManagedLoginBranding.Type).toBe("AWS::Cognito::ManagedLoginBranding");
    expect(template.Resources.loomCognitoUiTierGroup0.Type).toBe("AWS::Cognito::UserPoolGroup");

    const brandingProps = template.Resources.loomCognitoManagedLoginBranding.Properties;
    expect(brandingProps.ClientId).toEqual({ Ref: "loomCognitoUserClient" });
  });
});
