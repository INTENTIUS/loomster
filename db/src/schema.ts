import { index, table } from "@intentius/chant-lexicon-sql/postgres";

export const a2aAgents = table<"public.a2a_agents">`
  CREATE TABLE public.a2a_agents (
      id serial,
      base_url character varying NOT NULL,
      name character varying NOT NULL,
      description text NOT NULL,
      agent_version character varying NOT NULL,
      documentation_url character varying,
      provider_organization character varying,
      provider_url character varying,
      capabilities text NOT NULL,
      authentication_schemes text NOT NULL,
      default_input_modes text NOT NULL,
      default_output_modes text NOT NULL,
      agent_card_raw text NOT NULL,
      status character varying NOT NULL,
      auth_type character varying NOT NULL,
      oauth2_well_known_url character varying,
      oauth2_client_id character varying,
      oauth2_client_secret character varying,
      has_oauth2_secret character varying,
      oauth2_scopes character varying,
      delegation_mode character varying NOT NULL,
      obo_grant_type character varying,
      agentcore_session_id character varying,
      registry_record_id character varying,
      registry_status character varying,
      resource_tags text,
      last_fetched_at timestamp without time zone,
      created_at timestamp without time zone NOT NULL,
      updated_at timestamp without time zone NOT NULL,
      CONSTRAINT a2a_agents_pkey PRIMARY KEY (id)
  )`;

export const a2aAgentAccess = table<"public.a2a_agent_access">`
  CREATE TABLE public.a2a_agent_access (
      id serial,
      agent_id integer NOT NULL,
      persona_id integer NOT NULL,
      access_level character varying NOT NULL,
      allowed_skill_ids text,
      created_at timestamp without time zone NOT NULL,
      updated_at timestamp without time zone NOT NULL,
      CONSTRAINT a2a_agent_access_pkey PRIMARY KEY (id),
      CONSTRAINT a2a_agent_access_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES ${a2aAgents}(id) ON DELETE CASCADE
  )`;

export const a2aAgentSkills = table<"public.a2a_agent_skills">`
  CREATE TABLE public.a2a_agent_skills (
      id serial,
      agent_id integer NOT NULL,
      skill_id character varying NOT NULL,
      name character varying NOT NULL,
      description text NOT NULL,
      tags text NOT NULL,
      examples text,
      input_modes text,
      output_modes text,
      last_refreshed_at timestamp without time zone NOT NULL,
      CONSTRAINT a2a_agent_skills_pkey PRIMARY KEY (id),
      CONSTRAINT a2a_agent_skills_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES ${a2aAgents}(id) ON DELETE CASCADE
  )`;

export const vpcConfigs = table<"public.vpc_configs">`
  CREATE TABLE public.vpc_configs (
      id serial,
      name character varying NOT NULL,
      description text,
      vpc_id character varying NOT NULL,
      subnet_ids text NOT NULL,
      sg_ids text NOT NULL,
      created_at timestamp without time zone,
      updated_at timestamp without time zone,
      CONSTRAINT vpc_configs_pkey PRIMARY KEY (id),
      CONSTRAINT vpc_configs_name_key UNIQUE (name)
  )`;

export const agents = table<"public.agents">`
  CREATE TABLE public.agents (
      id serial,
      arn character varying NOT NULL,
      runtime_id character varying NOT NULL,
      name character varying,
      status character varying,
      region character varying NOT NULL,
      account_id character varying NOT NULL,
      log_group character varying,
      available_qualifiers text,
      raw_metadata text,
      source character varying,
      deployment_status character varying,
      execution_role_arn character varying,
      config_hash character varying,
      endpoint_name character varying,
      endpoint_arn character varying,
      endpoint_status character varying,
      protocol character varying,
      network_mode character varying,
      agent_framework character varying,
      authorizer_config text,
      description text,
      tags text,
      deployed_at timestamp without time zone,
      registered_at timestamp without time zone NOT NULL,
      last_refreshed_at timestamp without time zone,
      registry_record_id character varying,
      registry_status character varying,
      allowed_model_ids text,
      harness_id character varying,
      code_interpreter_id character varying,
      vpc_subnet_ids text,
      vpc_security_group_ids text,
      vpc_config_id integer,
      status_reason character varying,
      code_uri character varying,
      CONSTRAINT agents_pkey PRIMARY KEY (id),
      CONSTRAINT agents_vpc_config_id_fkey FOREIGN KEY (vpc_config_id) REFERENCES ${vpcConfigs}(id)
  )`;

export const agentConfigEntries = table<"public.agent_config_entries">`
  CREATE TABLE public.agent_config_entries (
      id serial,
      agent_id integer NOT NULL,
      key character varying NOT NULL,
      value character varying,
      is_secret boolean NOT NULL,
      source character varying,
      created_at timestamp without time zone NOT NULL,
      updated_at timestamp without time zone,
      CONSTRAINT agent_config_entries_pkey PRIMARY KEY (id),
      CONSTRAINT uq_config_agent_key UNIQUE (agent_id, key),
      CONSTRAINT agent_config_entries_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES ${agents}(id) ON DELETE CASCADE
  )`;

export const credentialProviders = table<"public.credential_providers">`
  CREATE TABLE public.credential_providers (
      id serial,
      agent_id integer NOT NULL,
      name character varying NOT NULL,
      vendor character varying,
      callback_url character varying,
      scopes character varying,
      provider_type character varying,
      created_at timestamp without time zone NOT NULL,
      CONSTRAINT credential_providers_pkey PRIMARY KEY (id),
      CONSTRAINT credential_providers_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES ${agents}(id) ON DELETE CASCADE
  )`;

export const agentIntegrations = table<"public.agent_integrations">`
  CREATE TABLE public.agent_integrations (
      id serial,
      agent_id integer NOT NULL,
      integration_type character varying,
      integration_config character varying,
      credential_provider_id integer,
      enabled boolean NOT NULL,
      created_at timestamp without time zone NOT NULL,
      updated_at timestamp without time zone,
      CONSTRAINT agent_integrations_pkey PRIMARY KEY (id),
      CONSTRAINT agent_integrations_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES ${agents}(id) ON DELETE CASCADE,
      CONSTRAINT agent_integrations_credential_provider_id_fkey FOREIGN KEY (credential_provider_id) REFERENCES ${credentialProviders}(id) ON DELETE SET NULL
  )`;

export const approvalLogs = table<"public.approval_logs">`
  CREATE TABLE public.approval_logs (
      id serial,
      request_id character varying NOT NULL,
      session_id character varying,
      agent_id integer,
      tool_name character varying NOT NULL,
      tool_input_summary text,
      policy_name character varying,
      pattern_type character varying NOT NULL,
      status character varying NOT NULL,
      requested_at timestamp without time zone DEFAULT now(),
      decided_at timestamp without time zone,
      decided_by character varying,
      reason text,
      CONSTRAINT approval_logs_pkey PRIMARY KEY (id)
  )`;

export const approvalPolicies = table<"public.approval_policies">`
  CREATE TABLE public.approval_policies (
      id serial,
      name character varying NOT NULL,
      policy_type character varying NOT NULL,
      tool_match_rules text,
      approval_mode character varying NOT NULL,
      timeout_seconds integer NOT NULL,
      agent_scope text,
      approval_cache_ttl integer NOT NULL,
      enabled boolean NOT NULL,
      created_at timestamp without time zone DEFAULT now(),
      updated_at timestamp without time zone DEFAULT now(),
      CONSTRAINT approval_policies_pkey PRIMARY KEY (id),
      CONSTRAINT approval_policies_name_key UNIQUE (name)
  )`;

export const auditAction = table<"public.audit_action">`
  CREATE TABLE public.audit_action (
      id serial,
      user_id character varying NOT NULL,
      browser_session_id character varying NOT NULL,
      action_category character varying NOT NULL,
      action_type character varying NOT NULL,
      resource_name character varying,
      performed_at timestamp without time zone DEFAULT now() NOT NULL,
      CONSTRAINT audit_action_pkey PRIMARY KEY (id)
  )`;

export const auditLogin = table<"public.audit_login">`
  CREATE TABLE public.audit_login (
      id serial,
      user_id character varying NOT NULL,
      browser_session_id character varying NOT NULL,
      logged_in_at timestamp without time zone DEFAULT now() NOT NULL,
      CONSTRAINT audit_login_pkey PRIMARY KEY (id)
  )`;

export const auditPageView = table<"public.audit_page_view">`
  CREATE TABLE public.audit_page_view (
      id serial,
      user_id character varying NOT NULL,
      browser_session_id character varying NOT NULL,
      page_name character varying NOT NULL,
      entered_at timestamp without time zone NOT NULL,
      duration_seconds integer,
      CONSTRAINT audit_page_view_pkey PRIMARY KEY (id)
  )`;

export const authorizerConfigs = table<"public.authorizer_configs">`
  CREATE TABLE public.authorizer_configs (
      id serial,
      name character varying NOT NULL,
      authorizer_type character varying NOT NULL,
      pool_id character varying,
      discovery_url character varying,
      allowed_audience text,
      allowed_clients text,
      allowed_scopes text,
      client_id character varying,
      client_secret_arn character varying,
      user_client_id character varying,
      user_client_secret_arn character varying,
      user_redirect_uri character varying,
      tags text,
      created_at timestamp without time zone DEFAULT now(),
      updated_at timestamp without time zone DEFAULT now(),
      CONSTRAINT authorizer_configs_pkey PRIMARY KEY (id),
      CONSTRAINT authorizer_configs_name_key UNIQUE (name)
  )`;

export const authorizerCredentials = table<"public.authorizer_credentials">`
  CREATE TABLE public.authorizer_credentials (
      id serial,
      authorizer_config_id integer NOT NULL,
      label character varying NOT NULL,
      client_id character varying NOT NULL,
      client_secret_arn character varying,
      created_at timestamp without time zone DEFAULT now(),
      CONSTRAINT authorizer_credentials_pkey PRIMARY KEY (id),
      CONSTRAINT authorizer_credentials_authorizer_config_id_fkey FOREIGN KEY (authorizer_config_id) REFERENCES ${authorizerConfigs}(id)
  )`;

export const evaluationTestCases = table<"public.evaluation_test_cases">`
  CREATE TABLE public.evaluation_test_cases (
      id serial,
      agent_id integer NOT NULL,
      name character varying NOT NULL,
      prompt text NOT NULL,
      expected_response text,
      evaluator_ids text NOT NULL,
      pass_threshold double precision NOT NULL,
      model_id character varying,
      last_batch_evaluation_id character varying,
      last_run_at timestamp without time zone,
      created_at timestamp without time zone NOT NULL,
      updated_at timestamp without time zone,
      CONSTRAINT evaluation_test_cases_pkey PRIMARY KEY (id),
      CONSTRAINT evaluation_test_cases_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES ${agents}(id) ON DELETE CASCADE
  )`;

export const evaluationRuns = table<"public.evaluation_runs">`
  CREATE TABLE public.evaluation_runs (
      id serial,
      test_case_id integer NOT NULL,
      session_id character varying NOT NULL,
      status character varying NOT NULL,
      results_json text NOT NULL,
      errors_json text NOT NULL,
      created_at timestamp without time zone NOT NULL,
      updated_at timestamp without time zone,
      CONSTRAINT evaluation_runs_pkey PRIMARY KEY (id),
      CONSTRAINT evaluation_runs_test_case_id_fkey FOREIGN KEY (test_case_id) REFERENCES ${evaluationTestCases}(id) ON DELETE CASCADE
  )`;

export const identityProviders = table<"public.identity_providers">`
  CREATE TABLE public.identity_providers (
      id serial,
      name character varying NOT NULL,
      provider_type character varying NOT NULL,
      issuer_url character varying NOT NULL,
      client_id character varying NOT NULL,
      client_secret_arn character varying,
      client_type character varying,
      scopes character varying,
      audience character varying,
      group_claim_path character varying,
      group_mappings text,
      status character varying NOT NULL,
      jwks_uri character varying,
      authorization_endpoint character varying,
      token_endpoint character varying,
      discovery_scopes text,
      created_at timestamp without time zone DEFAULT now(),
      updated_at timestamp without time zone DEFAULT now(),
      CONSTRAINT identity_providers_pkey PRIMARY KEY (id),
      CONSTRAINT identity_providers_name_key UNIQUE (name)
  )`;

export const invocationSessions = table<"public.invocation_sessions">`
  CREATE TABLE public.invocation_sessions (
      agent_id integer NOT NULL,
      session_id character varying,
      qualifier character varying NOT NULL,
      status character varying NOT NULL,
      created_at timestamp without time zone NOT NULL,
      user_id character varying,
      hidden_at timestamp without time zone,
      CONSTRAINT invocation_sessions_pkey PRIMARY KEY (session_id),
      CONSTRAINT invocation_sessions_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES ${agents}(id) ON DELETE CASCADE
  )`;

export const invocations = table<"public.invocations">`
  CREATE TABLE public.invocations (
      id serial,
      session_id character varying NOT NULL,
      invocation_id character varying NOT NULL,
      request_id character varying,
      client_invoke_time double precision,
      client_done_time double precision,
      agent_start_time double precision,
      cold_start_latency_ms double precision,
      client_duration_ms double precision,
      input_tokens integer,
      output_tokens integer,
      estimated_cost double precision,
      compute_cost double precision,
      compute_cpu_cost double precision,
      compute_memory_cost double precision,
      idle_timeout_cost double precision,
      idle_cpu_cost double precision,
      idle_memory_cost double precision,
      memory_retrievals integer,
      memory_events_sent integer,
      memory_estimated_cost double precision,
      stm_cost double precision,
      ltm_cost double precision,
      cost_source character varying,
      status character varying NOT NULL,
      error_message text,
      prompt_text text,
      thinking_text text,
      response_text text,
      created_at timestamp without time zone NOT NULL,
      CONSTRAINT invocations_pkey PRIMARY KEY (id),
      CONSTRAINT invocations_session_id_fkey FOREIGN KEY (session_id) REFERENCES ${invocationSessions}(session_id) ON DELETE CASCADE
  )`;

export const managedRoles = table<"public.managed_roles">`
  CREATE TABLE public.managed_roles (
      id serial,
      role_name character varying NOT NULL,
      role_arn character varying NOT NULL,
      role_type character varying NOT NULL,
      description text,
      policy_document text,
      tags text,
      created_at timestamp without time zone DEFAULT now(),
      updated_at timestamp without time zone DEFAULT now(),
      CONSTRAINT managed_roles_pkey PRIMARY KEY (id),
      CONSTRAINT managed_roles_role_arn_key UNIQUE (role_arn)
  )`;

export const mcpServers = table<"public.mcp_servers">`
  CREATE TABLE public.mcp_servers (
      id serial,
      name character varying NOT NULL,
      description text,
      endpoint_url character varying NOT NULL,
      transport_type character varying NOT NULL,
      status character varying NOT NULL,
      auth_type character varying NOT NULL,
      oauth2_well_known_url character varying,
      oauth2_client_id character varying,
      oauth2_client_secret character varying,
      has_oauth2_secret character varying,
      oauth2_scopes character varying,
      delegation_mode character varying NOT NULL,
      obo_grant_type character varying,
      oauth2_audience character varying,
      api_key_header_name character varying,
      has_admin_api_key character varying,
      supports_elicitation character varying,
      runtime_endpoint_url character varying,
      registry_record_id character varying,
      registry_status character varying,
      tags text,
      created_at timestamp without time zone NOT NULL,
      updated_at timestamp without time zone NOT NULL,
      CONSTRAINT mcp_servers_pkey PRIMARY KEY (id)
  )`;

export const mcpServerAccess = table<"public.mcp_server_access">`
  CREATE TABLE public.mcp_server_access (
      id serial,
      server_id integer NOT NULL,
      persona_id integer NOT NULL,
      access_level character varying NOT NULL,
      allowed_tool_names text,
      created_at timestamp without time zone NOT NULL,
      updated_at timestamp without time zone NOT NULL,
      CONSTRAINT mcp_server_access_pkey PRIMARY KEY (id),
      CONSTRAINT mcp_server_access_server_id_fkey FOREIGN KEY (server_id) REFERENCES ${mcpServers}(id) ON DELETE CASCADE
  )`;

export const mcpTools = table<"public.mcp_tools">`
  CREATE TABLE public.mcp_tools (
      id serial,
      server_id integer NOT NULL,
      tool_name character varying NOT NULL,
      description text,
      input_schema text,
      last_refreshed_at timestamp without time zone NOT NULL,
      CONSTRAINT mcp_tools_pkey PRIMARY KEY (id),
      CONSTRAINT mcp_tools_server_id_fkey FOREIGN KEY (server_id) REFERENCES ${mcpServers}(id) ON DELETE CASCADE
  )`;

export const memories = table<"public.memories">`
  CREATE TABLE public.memories (
      id serial,
      name character varying NOT NULL,
      description character varying,
      arn character varying,
      memory_id character varying,
      region character varying NOT NULL,
      account_id character varying NOT NULL,
      status character varying NOT NULL,
      event_expiry_duration integer NOT NULL,
      memory_execution_role_arn character varying,
      encryption_key_arn character varying,
      strategies_config text,
      strategies_response text,
      tags text,
      failure_reason character varying,
      created_at timestamp without time zone,
      updated_at timestamp without time zone,
      CONSTRAINT memories_pkey PRIMARY KEY (id)
  )`;

export const siteSettings = table<"public.site_settings">`
  CREATE TABLE public.site_settings (
      id serial,
      key character varying NOT NULL,
      value character varying NOT NULL,
      updated_at timestamp without time zone,
      CONSTRAINT site_settings_pkey PRIMARY KEY (id)
  )`;

export const tagPolicies = table<"public.tag_policies">`
  CREATE TABLE public.tag_policies (
      id serial,
      key character varying NOT NULL,
      default_value character varying,
      source character varying,
      required boolean NOT NULL,
      show_on_card boolean NOT NULL,
      created_at timestamp without time zone,
      updated_at timestamp without time zone,
      CONSTRAINT tag_policies_pkey PRIMARY KEY (id),
      CONSTRAINT tag_policies_key_key UNIQUE (key)
  )`;

export const tagProfiles = table<"public.tag_profiles">`
  CREATE TABLE public.tag_profiles (
      id serial,
      name character varying NOT NULL,
      tags text NOT NULL,
      created_at timestamp without time zone,
      updated_at timestamp without time zone,
      CONSTRAINT tag_profiles_pkey PRIMARY KEY (id),
      CONSTRAINT tag_profiles_name_key UNIQUE (name)
  )`;

export const ixAgentConfigEntriesAgentId = index`
  CREATE INDEX ix_agent_config_entries_agent_id ON ${agentConfigEntries} USING btree (agent_id)`;

export const ixAgentIntegrationsAgentId = index`
  CREATE INDEX ix_agent_integrations_agent_id ON ${agentIntegrations} USING btree (agent_id)`;

export const ixAgentsArn = index`
  CREATE UNIQUE INDEX ix_agents_arn ON ${agents} USING btree (arn)`;

export const ixAgentsRuntimeId = index`
  CREATE INDEX ix_agents_runtime_id ON ${agents} USING btree (runtime_id)`;

export const ixApprovalLogsAgentId = index`
  CREATE INDEX ix_approval_logs_agent_id ON ${approvalLogs} USING btree (agent_id)`;

export const ixApprovalLogsRequestId = index`
  CREATE INDEX ix_approval_logs_request_id ON ${approvalLogs} USING btree (request_id)`;

export const ixApprovalLogsSessionId = index`
  CREATE INDEX ix_approval_logs_session_id ON ${approvalLogs} USING btree (session_id)`;

export const ixCredentialProvidersAgentId = index`
  CREATE INDEX ix_credential_providers_agent_id ON ${credentialProviders} USING btree (agent_id)`;

export const ixEvaluationRunsCreatedAt = index`
  CREATE INDEX ix_evaluation_runs_created_at ON ${evaluationRuns} USING btree (created_at)`;

export const ixEvaluationRunsTestCaseId = index`
  CREATE INDEX ix_evaluation_runs_test_case_id ON ${evaluationRuns} USING btree (test_case_id)`;

export const ixEvaluationTestCasesAgentId = index`
  CREATE INDEX ix_evaluation_test_cases_agent_id ON ${evaluationTestCases} USING btree (agent_id)`;

export const ixInvocationSessionsAgentId = index`
  CREATE INDEX ix_invocation_sessions_agent_id ON ${invocationSessions} USING btree (agent_id)`;

export const ixInvocationSessionsCreatedAt = index`
  CREATE INDEX ix_invocation_sessions_created_at ON ${invocationSessions} USING btree (created_at)`;

export const ixInvocationSessionsUserId = index`
  CREATE INDEX ix_invocation_sessions_user_id ON ${invocationSessions} USING btree (user_id)`;

export const ixInvocationsCreatedAt = index`
  CREATE INDEX ix_invocations_created_at ON ${invocations} USING btree (created_at)`;

export const ixInvocationsInvocationId = index`
  CREATE UNIQUE INDEX ix_invocations_invocation_id ON ${invocations} USING btree (invocation_id)`;

export const ixInvocationsSessionId = index`
  CREATE INDEX ix_invocations_session_id ON ${invocations} USING btree (session_id)`;

export const ixSiteSettingsKey = index`
  CREATE UNIQUE INDEX ix_site_settings_key ON ${siteSettings} USING btree (key)`;
