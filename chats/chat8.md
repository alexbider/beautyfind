# Master admin dashboard setup

_Started 2026-09-19 11:22 UTC_

---

## User

Continuing from "Client deletion feature".

## Assistant

We've been building Noa Clinic (קליניקת נועה), a comprehensive clinic management app separate from BeautyFind. The scope is large — five core workflows fully functional, with remaining modules honestly marked בבנייה.

**Decisions locked:**
- App operates on one shared dataset: 5 staff, 3 rooms, 2 devices, 12 services, 3 packages, 20 clients, full weekly schedule.
- Role-based access (בעלים / מזכירות / מטפלת / הנה״ח) filters nav and shows restricted-access states.
- Timeline-based event logging for clients and requests, colour-coded history.
- Appointments use drag-to-reschedule with conflict detection (staff busy, device busy, certification gaps) and suggest alternatives.
- Checkout is an 8-step completion flow with duplicate guards — can't issue documents before payment, can't redeem twice.
- KPIs separate נגבה from pipeline value (שווי תורים).

**Current state:**
- Shell, סקירה (dashboard), יומן (calendar with day/week/staff views), לקוחות (table + 9-tab profile), פניות (7-stage kanban), and קופה (checkout) are all live and connected.
- Notifications, משימות, תשלומים, שירותים, צוות, דוחות, יומן פעילות are working screens.
- Breakpoints fixed: ResizeObserver now guards against redundant setState; 924px triggers 2-up KPI grid, 1100px shows sidebar.
- מלאי, אוטומציות, אינטגרציות, הגדרות are marked בבנייה.

**Next steps:**
- Decide which בבנייה module to build next.
- Further polish and edge-case testing as needed.

**Files:** Noa Clinic.dc.html

## User

now we need to add a profile control (editing) , profile analytics, accounting subscription so we will have master interface that has all of it and the client can do from screen to screen and business user will have different permissions as per their role, so only master admin will see all and can control what others can see and control

## Assistant

_[tool: grep]_

_[tool: list_files]_

_[tool: grep]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

Now writing the new modules. First the logic constants and permission model:

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_set_props]_

_[tool: show_html]_

_[tool: get_webview_logs]_

_[tool: ready_for_verification]_

The dashboard is now a master interface with role-aware access:

**New screens** — אנליטיקת פרופיל (search terms, geography, device, day curve, benchmark vs. area median, contacts per treatment), עריכת פרופיל (business details, category, description, medical responsibility, hours, card flags, publish flow with gaps list), מנוי וחשבונות (three plan tiers with upgrade confirmation, toggleable add-ons, live net/VAT/gross total, ח.פ + invoice + CPA routing, quarterly VAT summary with CSV export), and צוות והרשאות.

**Permissions** — header switcher shows the dashboard exactly as בעלים / מנהלת קליניקה / מזכירות / הנהלת חשבונות see it. Only the master admin sees צוות והרשאות and can cycle each screen × role cell between אין גישה / צפייה / עריכה; nav filters to permitted screens, view-only screens show a lock banner and hide every edit control. Inviting a user and changing or removing roles works live.

## User

Found issues — fixing…

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

Fixed: typo corrected, VAT now 18% in the label, the monthly summary and the quarterly table, and each role now lands on its first editable screen (הנהלת חשבונות opens on מנוי וחשבונות).

## User

לקוחות will be link to the crm of the clinic and need to add it to the הרשאות so admin can decide who can work on the crm, and give this tab a relevant name

## Assistant

_[tool: dc_js_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

The tab is now **ניהול לקוחות · CRM** in the nav and in the permissions matrix (so the master admin sets אין גישה / צפייה / עריכה per role for it), and its screen header carries a link through to the clinic CRM — Noa Clinic.

