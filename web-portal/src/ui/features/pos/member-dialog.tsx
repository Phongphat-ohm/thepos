import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Search, UserCheck, UserPlus } from "lucide-react";
import { memberInput } from "@thepos/contracts";
import { Field } from "@/components/common/fields";
import { Loading } from "@/components/common/loading";
import { Button } from "@/components/ui/button";
import { notifyError, notifySuccess } from "@/lib/alerts";
import { business, errorMessage } from "@/lib/native";
import type { Member } from "./model";

export function MemberDialog({
  write,
  current,
  select,
  onSaving,
}: {
  write: boolean;
  current: Member | null;
  select: (member: Member | null) => void;
  onSaving: (busy: boolean) => void;
}) {
  const [mode, setMode] = useState<"search" | "create">("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Member[]>([]);
  const [picked, setPicked] = useState<Member | null>(current);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const runSearch = useCallback(async (q: string) => {
    setBusy(true);
    setError("");
    try {
      const { items } = await business<{ items: Member[] }>("pos_members", { query: { q } });
      setResults(items);
      setLoaded(true);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void runSearch("");
  }, [runSearch]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch(query.trim());
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = new FormData(event.currentTarget);
    const parsed = memberInput.safeParse({
      number: input.get("number"),
      name: input.get("name"),
      phone: input.get("phone") || undefined,
      barcode: input.get("barcode") || undefined,
    });
    if (!parsed.success) {
      setError("ตรวจสอบเลขสมาชิก ชื่อ และเบอร์โทรก่อนบันทึก");
      return;
    }
    setBusy(true);
    setError("");
    onSaving(true);
    try {
      const created = await business<Member>("add_member", { input: parsed.data });
      notifySuccess("เพิ่มสมาชิกแล้ว");
      select(created);
    } catch (reason) {
      void notifyError("เพิ่มสมาชิกไม่สำเร็จ", errorMessage(reason));
    } finally {
      setBusy(false);
      onSaving(false);
    }
  }

  return (
    <div className="form-stack">
      {write && (
        <div className="register-inline">
          <Button
            type="button"
            variant={mode === "search" ? "default" : "outline"}
            onClick={() => { setError(""); setMode("search"); }}
          >
            <Search size={15} /> ค้นหาสมาชิก
          </Button>
          <Button
            type="button"
            variant={mode === "create" ? "default" : "outline"}
            onClick={() => { setError(""); setMode("create"); }}
          >
            <UserPlus size={15} /> เพิ่มสมาชิกใหม่
          </Button>
          {current && (
            <Button type="button" variant="ghost" onClick={() => select(null)}>
              ขายแบบลูกค้าทั่วไป
            </Button>
          )}
        </div>
      )}

      {error && <div className="notice" role="alert">{error}</div>}
      {busy && mode === "search" && <Loading label="กำลังค้นหาสมาชิก" variant="inline" />}

      {mode === "search" ? (
        <>
          <form className="stock-inline" onSubmit={search}>
            <Field
              autoFocus
              name="q"
              label="เลขสมาชิก ชื่อ บาร์โค้ด หรือเบอร์โทร"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={100}
            />
            <Button disabled={busy} type="submit">ค้นหา</Button>
          </form>

          {loaded && results.length === 0 && <p role="status">ไม่พบสมาชิก</p>}

          {results.length > 0 && (
            <div className="member-pick-list" role="listbox" aria-label="รายชื่อสมาชิกที่พบ">
              {results.map((member) => {
                const isSelected = picked?.id === member.id;
                return (
                  <button
                    key={member.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`member-pick-card${isSelected ? " is-selected" : ""}`}
                    onClick={() => setPicked(member)}
                  >
                    <div>
                      <strong>{member.name}</strong>
                      <small>เลขสมาชิก: {member.number}</small>
                    </div>
                    {isSelected && <Check size={18} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          )}

          <div className="form-actions">
            {!write && current && (
              <Button type="button" variant="outline" onClick={() => select(null)}>
                ขายแบบลูกค้าทั่วไป
              </Button>
            )}
            <Button
              type="button"
              className="primary-action"
              disabled={!picked}
              onClick={() => { if (picked) select(picked); }}
            >
              <UserCheck size={16} /> ยืนยันเลือกสมาชิก{picked ? ` (${picked.name})` : ""}
            </Button>
          </div>
        </>
      ) : (
        <form className="form-stack" onSubmit={(event) => void add(event)}>
          <div className="field-row">
            <Field autoFocus name="number" label="เลขสมาชิก" required maxLength={50} />
            <Field name="name" label="ชื่อสมาชิก" required maxLength={120} />
            <Field name="barcode" label="บาร์โค้ดบัตร" maxLength={100} />
            <Field name="phone" label="เบอร์โทรศัพท์" inputMode="tel" maxLength={10} />
          </div>
          <div className="form-actions">
            <Button type="button" variant="ghost" onClick={() => setMode("search")}>กลับไปค้นหา</Button>
            <Button disabled={busy} type="submit" className="primary-action">บันทึกข้อมูลสมาชิก</Button>
          </div>
        </form>
      )}
    </div>
  );
}
