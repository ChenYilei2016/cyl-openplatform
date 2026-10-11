import type { AdminApi } from "../access/api";
import GovernanceRules from "./GovernanceRules";
import "./governance.css";

export default function GovernanceWorkspace(props: {
  api: AdminApi;
  permissions: string[];
}) {
  return <GovernanceRules {...props} />;
}
