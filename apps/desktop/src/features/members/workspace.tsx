import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Pencil, RefreshCw, Search, UserPlus } from "lucide-react";
import {
  memberProfileInput, type MemberProfile, type MemberPurchases, type MemberShares, type Page, type Profile,
} from "@thepos/contracts";
import { Field } from "@/components/fields";
import { Modal } from "@/components/modal";
import { Loading } from "@/components/loading";
import { Button } from "@/components/ui/button";
import { notifyError, notifySuccess } from "@/lib/alerts";
import { business, errorMessage } from "@/lib/native";
import { Pagination, Select, Table, thaiDate, toggleSort, type SortDir } from "../stock/shared";
import { ShareForm, shareLabels, today } from "./share-form";

type MemberRow = Pick<MemberProfile, "id" | "name" | "number" | "phone" | "isActive">;
const emptyPage = { items: [], nextCursor: null };
const count = new Intl.NumberFormat("th-TH");

export function MembersWorkspace({ profile }: { profile: Profile }) {
  const canWrite = profile.capabilities?.includes("member:write") ?? false;
  const canPost = profile.capabilities?.includes("shares:write") ?? false;
  const [list, setList] = useState<Page<MemberRow>>(emptyPage);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState("number");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [member, setMember] = useState<MemberProfile | null>(null);
  const [editor, setEditor] = useState<"create" | "edit" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listSeq = useRef(0);

  async function load(q = applied, nextPage = pageNum, nextSize = pageSize, nextSortBy = sortBy, nextSortDir = sortDir) {
    const seq = ++listSeq.current;
    setBusy(true);
    setError("");
    try {
      const rows = await business<Page<MemberRow>>("members", {
        query: {
          q: q.trim() || undefined,
          page: nextPage,
          limit: nextSize,
          sortBy: nextSortBy,
          sortDir: nextSortDir,
        },
      });
      if (seq !== listSeq.current) return;
      setApplied(q);
      setList(rows);
    } catch (reason) {
      if (seq === listSeq.current) setError(errorMessage(reason));
    } finally {
      if (seq === listSeq.current) setBusy(false);
    }
  }

  useEffect(() => { void load(applied, pageNum, pageSize, sortBy, sortDir); }, [pageNum, pageSize, sortBy, sortDir]);

  async function open(id: string) {
    setBusy(true);
    setError("");
    try { setMember(await business<MemberProfile>("member_detail", { id })); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  return (
    <section className="stock-workspace" aria-label="จัดการสมาชิก">
      {busy && <Loading label="กำลังโหลดข้อมูลสมาชิก" variant={list.items.length ? "panel" : "skeleton"} />}
      <div className="stock-content">
        {error && <p role="alert" className="form-error">{error}</p>}
        {member ? (
          <MemberDetail key={member.id} member={member} canPost={canPost} edit={canWrite ? () => setEditor("edit") : undefined}
            back={() => { setMember(null); void load(applied, pageNum, pageSize, sortBy, sortDir); }} />
        ) : (
          <>
            <div className="stock-section-title">
              <h2>ทะเบียนสมาชิก</h2>
              <div className="register-inline">
                <Button type="button" variant="outline" disabled={busy} onClick={() => void load(applied, pageNum, pageSize, sortBy, sortDir)}>
                  <RefreshCw size={15} /> รีเฟรช
                </Button>
                {canWrite && <Button type="button" onClick={() => setEditor("create")}><UserPlus size={16} /> เพิ่มสมาชิก</Button>}
              </div>
            </div>
            <form className="stock-inline stock-search" onSubmit={(event) => {
              event.preventDefault();
              setPageNum(1);
              void load(query.trim(), 1, pageSize, sortBy, sortDir);
            }}>
              <Field label="ค้นหาสมาชิก" placeholder="เลขสมาชิก ชื่อ บาร์โค้ด หรือเบอร์โทร" value={query}
                onChange={(event) => setQuery(event.target.value)} maxLength={100} />
              <Button type="submit" variant="outline" disabled={busy}><Search size={15} /> ค้นหา</Button>
            </form>
            <Table
              headings={[
                { label: "เลขสมาชิก", sortKey: "number" },
                { label: "ชื่อสมาชิก", sortKey: "name" },
                "เบอร์โทรศัพท์",
                { label: "สถานะ", sortKey: "isActive" },
                "รายละเอียด",
              ]}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={(key) => {
                const next = toggleSort(sortBy, sortDir, key, "asc");
                setSortBy(next.sortBy);
                setSortDir(next.sortDir);
                setPageNum(1);
              }}
              empty={!list.items.length && !busy ? "ไม่พบสมาชิก" : undefined}
            >
              {list.items.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.number}</strong></td><td>{row.name}</td><td>{row.phone ?? "—"}</td>
                  <td>{row.isActive ? "ใช้งาน" : "ปิดใช้งาน"}</td>
                  <td><Button type="button" variant="outline" disabled={busy} onClick={() => void open(row.id)}
                    aria-label={`เปิดข้อมูล ${row.number} ${row.name}`}>เปิดข้อมูล</Button></td>
                </tr>
              ))}
            </Table>
            <Pagination
              page={list.page ?? pageNum}
              pageSize={list.pageSize ?? pageSize}
              total={list.total ?? list.items.length}
              totalPages={list.totalPages ?? 1}
              onPageChange={setPageNum}
              onPageSizeChange={(next) => { setPageSize(next); setPageNum(1); }}
              disabled={busy}
            />
          </>
        )}
      </div>
      {editor && <ProfileForm member={editor === "edit" ? member : null} close={() => setEditor(null)} saved={(result) => {
        setEditor(null);
        setMember(result);
      }} />}
    </section>
  );
}

function ProfileForm({ member, close, saved }: {
  member: MemberProfile | null; close: () => void; saved: (result: MemberProfile) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = memberProfileInput.safeParse({
      number: data.get("number"), name: data.get("name"), phone: data.get("phone") || null,
      barcode: data.get("barcode") || null, address: data.get("address") || null,
      joinedOn: data.get("joinedOn") || null, isActive: data.get("status") === "active",
      nationalId: data.get("nationalId") || (data.has("removeNationalId") ? null : undefined),
    });
    if (!parsed.success) { setError("ตรวจสอบชื่อ เลขสมาชิก และรูปแบบข้อมูลอีกครั้ง"); return; }
    setError("");
    setBusy(true);
    try {
      const result = await business<MemberProfile>(member ? "update_member" : "create_member", { id: member?.id, input: parsed.data });
      notifySuccess("บันทึกข้อมูลสมาชิกแล้ว");
      saved(result);
    } catch (reason) {
      void notifyError("บันทึกสมาชิกไม่สำเร็จ", errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={member ? "แก้ไขข้อมูลสมาชิก" : "เพิ่มสมาชิก"} close={close} busy={busy && "กำลังบันทึกข้อมูลสมาชิก"}>
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <div className="field-row">
          <Field autoFocus name="number" label="เลขสมาชิก" required maxLength={50} defaultValue={member?.number} />
          <Field name="name" label="ชื่อและนามสกุล" required maxLength={120} defaultValue={member?.name} />
          <Field name="barcode" label="บาร์โค้ดบัตรสมาชิก" maxLength={100} defaultValue={member?.barcode ?? ""} />
          <Field name="phone" label="เบอร์โทรศัพท์" inputMode="tel" pattern="[0-9]{9,10}" maxLength={10} defaultValue={member?.phone ?? ""} />
          <Field name="joinedOn" label="วันที่สมัคร" type="date" max={today()} required={!member} defaultValue={member ? member.joinedOn ?? "" : today()} />
          <Select name="status" label="สถานะ" defaultValue={member?.isActive === false ? "inactive" : "active"}>
            <option value="active">ใช้งาน</option><option value="inactive">ปิดใช้งาน</option>
          </Select>
        </div>
        <Field name="address" label="ที่อยู่" maxLength={400} defaultValue={member?.address ?? ""} />
        <Field name="nationalId" label="เลขบัตรประชาชน" type="password" inputMode="numeric" autoComplete="off"
          pattern="[0-9]{13}" maxLength={13} hint={member?.hasNationalId ? "มีเลขบัตรอยู่แล้ว เว้นว่างเพื่อใช้เลขเดิม" : "กรอก 13 หลัก หากต้องการบันทึก"} />
        {member?.hasNationalId && <label className="stock-inline"><input name="removeNationalId" type="checkbox" /> ลบเลขบัตรเดิมเมื่อไม่ได้กรอกเลขใหม่</label>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>ยกเลิก</Button>
          <Button type="submit">บันทึกข้อมูล</Button>
        </div>
      </form>
    </Modal>
  );
}

function MemberDetail({ member, canPost, edit, back }: {
  member: MemberProfile; canPost: boolean; edit?: () => void; back: () => void;
}) {
  const [section, setSection] = useState<"profile" | "purchases" | "shares">("profile");
  const [version, setVersion] = useState(0);
  const [posting, setPosting] = useState<MemberShares | null>(null);

  return <>
    <div className="stock-section-title">
      <Button type="button" variant="ghost" onClick={back}><ArrowLeft size={16} /> ทะเบียนสมาชิก</Button>
      {edit && section === "profile" && <Button type="button" variant="outline" onClick={edit}><Pencil size={15} /> แก้ไขข้อมูล</Button>}
    </div>
    <div><h2>{member.name}</h2><p className="member-secondary">{member.number} · {member.isActive ? "ใช้งาน" : "ปิดใช้งาน"}</p></div>
    <nav className="register-inline" aria-label="ข้อมูลสมาชิก">
      {([["profile", "ข้อมูลสมาชิก"], ["purchases", "ยอดซื้อสะสม"], ["shares", "บัญชีหุ้น"]] as const).map(([id, label]) =>
        <Button key={id} type="button" variant={section === id ? "default" : "outline"} aria-pressed={section === id}
          onClick={() => setSection(id)}>{label}</Button>)}
    </nav>
    {section === "profile" ? (
      <dl className="member-facts">
        <div><dt>เบอร์โทรศัพท์</dt><dd>{member.phone ?? "—"}</dd></div>
        <div><dt>บาร์โค้ดบัตรสมาชิก</dt><dd>{member.barcode ?? "—"}</dd></div>
        <div><dt>วันที่สมัคร</dt><dd>{member.joinedOn ? thaiDate(member.joinedOn) : "—"}</dd></div>
        <div><dt>เลขบัตรประชาชน</dt><dd>{member.hasNationalId ? "บันทึกแล้ว" : "ยังไม่ได้บันทึก"}</dd></div>
        <div><dt>ที่อยู่</dt><dd>{member.address ?? "—"}</dd></div>
      </dl>
    ) : <Ledger key={section + version} section={section} id={member.id}
      post={canPost ? setPosting : undefined} active={member.isActive} />}
    {posting && <ShareForm member={member} shares={posting} close={() => setPosting(null)} saved={() => {
      setPosting(null); setVersion((n) => n + 1); notifySuccess("บันทึกรายการหุ้นแล้ว");
    }} />}
  </>;
}

function Ledger({ section, id, post, active }: {
  section: "purchases" | "shares"; id: string; post?: (shares: MemberShares) => void; active: boolean;
}) {
  const [purchases, setPurchases] = useState<MemberPurchases | null>(null);
  const [shares, setShares] = useState<MemberShares | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState(section === "purchases" ? "recordedAt" : "effectiveDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const seq = useRef(0);

  async function load(nextPage = pageNum, nextSize = pageSize, nextSortBy = sortBy, nextSortDir = sortDir) {
    const request = ++seq.current;
    setBusy(true);
    setError("");
    try {
      if (section === "purchases") {
        const data = await business<MemberPurchases>("member_purchases", {
          id,
          query: { page: nextPage, limit: nextSize, sortBy: nextSortBy, sortDir: nextSortDir },
        });
        if (seq.current === request) setPurchases(data);
      } else {
        const data = await business<MemberShares>("member_shares", {
          id,
          query: { page: nextPage, limit: nextSize, sortBy: nextSortBy, sortDir: nextSortDir },
        });
        if (seq.current === request) setShares(data);
      }
    } catch (reason) {
      if (seq.current === request) setError(errorMessage(reason));
    } finally {
      if (seq.current === request) setBusy(false);
    }
  }

  useEffect(() => {
    void load(pageNum, pageSize, sortBy, sortDir);
    return () => { seq.current++; };
  }, [pageNum, pageSize, sortBy, sortDir]);

  const currentPage = purchases ?? shares;

  return <>
    <div className="stock-section-title">
      <h3>{section === "purchases" ? "สมุดบัญชียอดซื้อ" : "ประวัติรายการหุ้น"}</h3>
      <div className="register-inline">
        <Button type="button" variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw size={15} /> รีเฟรช</Button>
        {shares && post && (shares.account || active) && <Button type="button" disabled={busy} onClick={() => post(shares)}>
          {shares.account ? "บันทึกรายการหุ้น" : "เปิดบัญชีหุ้น"}
        </Button>}
      </div>
    </div>
    {busy && <Loading label="กำลังโหลดประวัติสมาชิก" variant={purchases || shares ? "inline" : "skeleton"} />}
    {error && <p className="form-error" role="alert">{error}</p>}
    {purchases && <>
      <dl className="member-facts"><div><dt>ยอดซื้อสุทธิสะสม</dt><dd>{purchases.netTotal} บาท</dd></div></dl>
      <Table
        headings={[
          { label: "วันที่", sortKey: "recordedAt" },
          "รายการ",
          "เลขอ้างอิง",
          { label: "ยอดรวม (บาท)", sortKey: "grossAmount", numeric: true },
          { label: "ยอดสุทธิ (บาท)", sortKey: "netEligibleAmount", numeric: true },
        ]}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={(key) => {
          const next = toggleSort(sortBy, sortDir, key, "desc");
          setSortBy(next.sortBy);
          setSortDir(next.sortDir);
          setPageNum(1);
        }}
        empty={!purchases.items.length ? "ยังไม่มียอดซื้อหรือคืนสินค้า" : undefined}
      >
        {purchases.items.map((row) => <tr key={row.id}><td>{thaiDate(row.recordedAt)}</td>
          <td>{row.transactionType === "SALE" ? "ขาย" : row.transactionType === "RETURN" ? "คืนสินค้า" : "ปรับปรุง"}</td>
          <td>{row.reference ?? "—"}{row.reason && <small>{row.reason}</small>}</td>
          <td className="report-number">{row.grossAmount}</td>
          <td className="report-number">{row.netEligibleAmount}</td></tr>)}
      </Table>
    </>}
    {shares && <>
      {shares.account && <dl className="member-facts">
        <div><dt>หุ้นคงเหลือ</dt><dd>{count.format(shares.account.totalShares)} หุ้น</dd></div>
        <div><dt>มูลค่าต่อหุ้น</dt><dd>{shares.account.shareValue} บาท</dd></div>
        <div><dt>มูลค่าหุ้นคงเหลือ</dt><dd>{shares.account.currentBalance} บาท</dd></div>
      </dl>}
      <Table
        headings={[
          { label: "วันที่มีผล", sortKey: "effectiveDate" },
          "ประเภท",
          { label: "จำนวนหุ้น", sortKey: "shareQuantity", numeric: true },
          { label: "มูลค่า (บาท)", sortKey: "totalAmount", numeric: true },
          "ผู้อนุมัติ",
          "เหตุผล",
        ]}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={(key) => {
          const next = toggleSort(sortBy, sortDir, key, "desc");
          setSortBy(next.sortBy);
          setSortDir(next.sortDir);
          setPageNum(1);
        }}
        empty={!shares.items.length ? "ยังไม่มีบัญชีหุ้น" : undefined}
      >
        {shares.items.map((row) => <tr key={row.id}><td>{thaiDate(row.effectiveDate)}</td><td>{shareLabels[row.transactionType]}
          {row.transferId && <small title={row.transferId}>อ้างอิง {row.transferId.slice(0, 8)}</small>}</td>
          <td className="report-number">{row.shareQuantity > 0 ? "+" : ""}{count.format(row.shareQuantity)}</td>
          <td className="report-number">{row.totalAmount}</td>
          <td>{row.approvedBy}</td><td>{row.reason}</td></tr>)}
      </Table>
    </>}
    {currentPage && <Pagination
      page={currentPage.page ?? pageNum}
      pageSize={currentPage.pageSize ?? pageSize}
      total={currentPage.total ?? currentPage.items.length}
      totalPages={currentPage.totalPages ?? 1}
      onPageChange={setPageNum}
      onPageSizeChange={(next) => { setPageSize(next); setPageNum(1); }}
      disabled={busy}
    />}
  </>;
}

