GATE: OPEN 38 (rounds used up)

# Server admin UI and data reset

Kind: software, existing internal administration UI.
Visual direction: retain ThePOS navy, white surfaces, aligned summary metrics and compact controls. Use the project system font fallback; no photographs, invented facts, marketing hero, shader or scroll moments. Voice: direct Thai operational labels. No assumed facts, coined name, external form endpoint, client slots or stand-in photographs.

## Functional verification

- Server typecheck passed.
- Unit tests: 14 passed (server admin and existing server security).
- Isolated PostgreSQL integration test passed: reset, rollback on an unexpected referencing table, preserved security/grants, fresh bootstrap, append-only trigger restoration.
- Production/store database was not reset.

## Visual verification

Read-only fixture preview using the actual renderHtml function and synthetic store/device values. Screenshots: 1440, 1024, 820, 768, 390 and 320 px. Desktop and phone screenshots inspected. Mobile devices changed from a scrolling table to labelled rows. Light blue focus outline added inside the navy connection panel after the first check.

## Gate limitations and open findings

The gate inherited an existing build already on round 2, then exhausted its rounds. No waivers were added. Many checks require a promotional landing page (full-height hero, pictures, dealt moments, one heading per screen) and conflict with the compact admin workspace. The full first-run findings remain below; mobile clipping and dark-panel focus were subsequently addressed. The gate was not rerun after those fixes. This is not a GATE PASS.

- **hero-fill** — section#statsGrid "ฐานข้อมูล พร้อมใช้งาน ร้านค้า ร้านทดสอบ ": the next section shows on the first screen: it starts at 255px on a 900px screen (the hero ends at 227px)
- **flush** — main#main > div.page-head > div > p "ตรวจสอบระบบและเครื่อง POS ที่เชื่อมต่อจา": its last line sits 2px above the rule on top of section#statsGrid
- **flush** — main#main > div.workspace > aside.stack > section.panel:nth-of-type(1) "รายละเอียดระบบ Host 0.0.0.0 Port 3000 เร": its first line sits 0px under the top edge of aside.stack, where the ground changes
- **fold-cut** — h2#devicesHeading "เครื่อง POS ที่ลงทะเบียน": a 19px line is sliced by the bottom of the first screen (7px of it below the fold)
- **no-visual** — main#main > div.workspace > div.stack > section.panel.connection "เชื่อมต่อเครื่อง POS": no picture, effect or mock in this section; a feature section needs a visual
- **no-visual** — main#main > div.workspace > div.stack > section.panel:nth-of-type(2) "เครื่อง POS ที่ลงทะเบียน": no picture, effect or mock in this section; a feature section needs a visual
- **button-styles** — (one screen): 3 button styles on one screen: soft, outline #dce4ef ("รีเฟรชข้อมูล"); soft, outline #58677e ("คัดลอก URL"); soft, fill #ffffff, outline #dce4ef ("คัดลอกรหัส"); the odd one out: "คัดลอกรหัส"
- **button-styles** — (the page): 4 button styles on the page: soft, outline #dce4ef x2 ("รีเฟรชข้อมูล"); soft, fill #ffffff, outline #dce4ef x1 ("คัดลอกรหัส"); soft, outline #58677e x2 ("คัดลอก URL"); soft, fill #b91c1c x1 ("ล้างข้อมูลทั้งหมด")
- **cta** — main#main > div.page-head: the hero has no button (the nav's does not count)
- **copy-headline** — main#main > div.page-head > div > h1 "ข้อมูลเซิร์ฟเวอร์": "ข้อมูลเซิร์ฟเวอร์" does not name what is sold (pos, from flags); only the line under it does
- **section-gaps** — main#main > div.workspace > aside.stack / main#main > section.panel.danger-panel: 509px between these sections, +561% against the median 77px of gaps at a change of ground
- **focus-visible** — button#copyKeyBtn "คัดลอกรหัส": Tab stop 4, button "คัดลอกรหัส": its focus change is faint: 2.94:1 against the ground, 3:1 needed
- **moment-none** — (the page): a software page (--type) deals no moment: every kind carries one, two on a long page (moments.md)
- **hero-screen** — main#main > div.page-head "SERVER OVERVIEWข้อมูลเซิร์ฟเวอร์ตรวจสอบร": the hero ends at 227px on a 900px screen, 673px above the fold: it ends at the fold, 1px either way (SR-1)
- **hero-screen** — section#statsGrid "ฐานข้อมูลพร้อมใช้งานร้านค้าร้านทดสอบเครื": 645px of the next section shows on the first screen (from 255px on a 900px screen): nothing below the hero shows at load (SR-1)
- **section-height** — main#main > footer "ThePOS · การจัดการเซิร์ฟเวอร์การล้างข้อม": the section is 20px tall (0 screens), 880px short of one screen (900px): every section after the hero is one screen or two, 2px either way (SR-2)
- **section-height** — section#statsGrid "ฐานข้อมูลพร้อมใช้งานร้านค้าร้านทดสอบเครื": the section is 112px tall (0.1 screens), 788px short of one screen (900px): every section after the hero is one screen or two, 2px either way (SR-2)
- **one-section** — main#main > div.page-head > div > h1 "ข้อมูลเซิร์ฟเวอร์": the screen at scroll 0px (stride 0) shows 112px of section 2 and the heading of section 1 whole and the content of 3 sections, over 24px each beside section 3: a screen shows one section (another may peek 8px, 24px WARN) (SR-4)
- **one-section** — section#statsGrid "ฐานข้อมูลพร้อมใช้งานร้านค้าร้านทดสอบเครื": the screen at scroll 255px (the top of section 2) shows 112px of section 2 and the content of 2 sections, over 24px each beside section 3: a screen shows one section (another may peek 8px, 24px WARN) (and 1 more like it: scroll 392px) (SR-4)
- **one-heading** — h2#devicesHeading "เครื่อง POS ที่ลงทะเบียน": the section holds 3 h2 headings: one per section, first in its .wrap (SR-5)
- **one-heading** — h2#resetHeading "ล้างข้อมูลเซิร์ฟเวอร์": headings of two sections show whole on one screen at 3 of 11 scroll positions (27.3%; at scroll 400, 450, 500px), here with "เชื่อมต่อเครื่อง POS": at most 3% on a desktop (SR-5)
- **container-edges** — header.topbar "ThePOS SERVER ADMIN รีเฟรชข้อมูลออกจากระ": the nav's content runs 168px from the left and 120px from the right (read from its outermost blocks: no .wrap): the page's container starts at 120px; 168 and 120px are not one margin; the margin is 64-120px at 1440px (one container, equal margins, 2px either way) (SR-6)
- **container-edges** — section#statsGrid "ฐานข้อมูลพร้อมใช้งานร้านค้าร้านทดสอบเครื": the content of section 2 runs 121px from the left and 121px from the right (read from its outermost blocks: no .wrap): the margin is 64-120px at 1440px (one container, equal margins, 2px either way) (and 1 more like it: "ล้างข้อมูลเซิร์ฟเวอร์ลบข") (SR-6)
- **container-edges** — a.skip "ข้ามไปเนื้อหา": a <a> at the top of the page, outside header.nav, main, footer.closing and nav.actionbar (SR-6)
- **container-edges** — aside.stack > section.panel:nth-of-type(1) > div.panel-head > h2 "รายละเอียดระบบ": the h2 starts 773px right of the container's left: every h1 and h2 starts on it, 2px either way (SR-6)
- **container-edges** — code#connectKeyText "POS-DEMO-DEMO-DEMO": 1 text block starts on a left line at x 162, 42px from the container's left: text starts on the container's left, or on one split line (x 630, 732, 834) (and 4 more like it: x 145, "เชื่อมต่อเครื่อง POS", "เครื่อง POS ที่ลงทะเบียน") (SR-6)
- **container-edges** — main#main > div.workspace > div.stack > section.panel.connection "เชื่อมต่อเครื่อง POSใช้ URL และรหัสนี้ใน": a box over half the container wide runs 120-844px, not on the container's lines at 120-1320px (SR-6)
- **container-edges** — main#main > div.workspace > div.stack > section.panel:nth-of-type(2) "เครื่อง POS ที่ลงทะเบียนผู้ใช้ล่าสุดและส": a box over half the container wide runs 120-844px, not on the container's lines at 120-1320px (SR-6)
- **flush** — span#updatedAt "อัปเดตล่าสุด 13:54:45": its last line sits 3px above the rule on top of section#statsGrid
- **cut-text** — tbody#devicesBody > tr:nth-of-type(1) > td:nth-of-type(4) > span.badge.ok "เปิดใช้งาน": cut 18px at the right by the overflow of main#main > div.workspace > div.stack > section.panel:nth-of-type(2) (and 1 more like it: "เปิดใช้งาน")
- **no-visual** — main#main > div.workspace > aside.stack "รายละเอียดระบบ": no picture, effect or mock in this section; a feature section needs a visual
- **text-only** — main#main > section.panel.danger-panel "ล้างข้อมูลเซิร์ฟเวอร์": the closing section is only text: no picture, icon, mock or effect in it
- **edge-right** — div.workspace section.panel "เครื่อง POS ที่ลงทะเบียนผู้ใช้ล่": ends at x 843.7; the right line is 1320
- **edge-left** — div.workspace section.panel "รายละเอียดระบบHost0.0.0.0Port300": starts at x 867.7; the lines are 120 and the column starts
- **one-sided** — div.workspace div.workspace "เชื่อมต่อเครื่อง POSใช้ URL และร": its visuals end at x 843.7, short of the right line 1320
- **screen-short** — section.panel.danger-panel section.panel.danger-panel "ล้างข้อมูลเซิร์ฟเวอร์ลบข้อมูลร้า": 136px tall; one screen under the nav is 900px
- **screen-height** — section.panel.danger-panel section.panel.danger-panel "ล้างข้อมูลเซิร์ฟเวอร์ลบข้อมูลร้า": 136px, 0.15 screens; a section is exactly one or two (--h)
- **hero-fold** — #statsGrid section.stats "ฐานข้อมูลพร้อมใช้งานร้านค้าร้านท": starts at y 255, not under the nav

## Performance

Skill perf check at 1440 and 390: 0 FAIL, 4 WARN. Transfer 84.6 KiB, CLS 0.000, no broken requests. Two repeated warnings concern busy host CPU; two concern logo dimensions, subsequently fixed by explicit width and height. Timings are limited by host load. Reset-dialog screenshot inspected; cancel receives initial focus and submit stays disabled until both confirmation fields are complete. Browser UI submission was not exercised against the live store.
