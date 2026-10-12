import { WatchOp } from "@intentius/chant/op";
import { deployment } from "../deployment";

// Every hour at :23, read the deployment as the reader and report drift: a
// declared object changed out of band, or gone. Objects src/ doesn't declare
// are never reported. Run it now with `just db drift`; on a schedule, from a
// runner that can reach the database (scripts/db/yodel.sh brings the tunnel
// up), with `scripts/db/yodel.sh watch`.
export const { op } = WatchOp({ name: `watch-${deployment}`, env: deployment, schedule: "23 * * * *" });
