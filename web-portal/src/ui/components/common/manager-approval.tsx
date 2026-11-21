import type { ManagerApproval } from "@thepos/contracts";
import { Pin, Username } from "./fields";

export function ManagerFields() {
  return (
    <fieldset className="register-approval">
      <legend>อนุมัติโดยผู้จัดการ</legend>
      <div className="field-row">
        <Username />
        <Pin />
      </div>
    </fieldset>
  );
}

export function approvalFrom(data: FormData): ManagerApproval {
  return { username: String(data.get("username") ?? ""), pin: String(data.get("pin") ?? "") };
}
