# Screen inventory

Generated from the design files. **Scenario props** are the Tweaks switches — every value is a state the production screen must support (some, like deposit settings, are real configuration). **Links** = direct file links in the prototype (public pages also use route strings, see `01-flows.md`).


## Client

### Account
- File: `BeautyFind Account.dc.html`
- Route: `/account`
- Purpose: My appointments, saved, reviews, privacy (export/delete).
- Links to: Saved, Gift Cards, Help, Search, Review, Booking, Business Profile, Legal

### Aftercare
- File: `BeautyFind Aftercare.dc.html`
- Route: `/b/:token/aftercare`
- Purpose: Phased do/don't, what's normal, red flags + emergency call, follow-up.
- Scenario props: `treatment: botox | laser | facial` · `phaseNow: int`
- Links to: Booking, Review

### Booking
- File: `BeautyFind Booking.dc.html`
- Route: `/book/:branch`
- Purpose: 4-step booking: treatment → practitioner → slot → details/consents; deposit per policy; medical → consult.
- Scenario props: `depositEnabled: boolean` · `depositMode: medical-fixed | all-fixed | percent | per-treatment` · `depositValue: int` · `depositRefundHours: int`
- Links to: Business Profile, Manage Booking, Health Declaration, Consult Request, Practitioner, Waitlist, Legal

### Business Profile
- File: `BeautyFind Business Profile.dc.html`
- Route: `/:region/biz/:slug`
- Purpose: Clinic profile: gallery, services & prices, team, reviews, hours, contact, save, mobile CTA bar.
- Scenario props: `primaryCta: booking | whatsapp | call` · `showBeforeAfter: boolean`

### Directory
- File: `BeautyFind Directory.dc.html`
- Route: `/:region/:city`
- Purpose: City / region / treatment listing with filters, sort, price table, local guide, FAQ, save hearts.
- Scenario props: `pageType: city | region | treatment`

### Health Declaration
- File: `BeautyFind Health Declaration.dc.html`
- Route: `/b/:token/declaration`
- Purpose: Medical or cosmetic questionnaire, medications, signature pad, attestation.
- Scenario props: `treatmentType: medical | cosmetic`
- Links to: Manage Booking, Account, Legal

### Homepage
- File: `BeautyFind Homepage.dc.html`
- Route: `/`
- Purpose: Entry: search by treatment + place, region map, categories, sponsored example, trust, magazine.
- Scenario props: `defaultRegion: all | north | haifa | sharon | dan | jerusalem | shfela | south` · `showSponsoredExample: boolean`

### Manage Booking
- File: `BeautyFind Manage Booking.dc.html`
- Route: `/b/:token`
- Purpose: Guest booking page: details, prep checklist, reschedule, cancel by policy.
- Scenario props: `hoursUntil: int` · `healthSigned: boolean` · `cancelWindow: int` · `depositOn: boolean` · `depositAmount: int`
- Links to: Auth, Business Profile, Receipt, Aftercare

### Practitioner
- File: `BeautyFind Practitioner.dc.html`
- Route: `/pro/:slug`
- Purpose: Practitioner: verified license/cert, treatments, CV, reviews, where to meet.
- Scenario props: `practitionerType: doctor | cosmetic`
- Links to: Business Profile, Region, Review, Standards

### Receipt
- File: `BeautyFind Receipt.dc.html`
- Route: `/receipt/:doc`
- Purpose: Tax invoice/receipt for deposit or full payment; credit note + refund tracker.
- Scenario props: `status: deposit | paid | refunding | refunded` · `depositAmount: int`
- Links to: Account

### Region
- File: `BeautyFind Region.dc.html`
- Route: `/:region`
- Purpose: Region landing: cities, categories, median prices, top businesses.

### Review
- File: `BeautyFind Review.dc.html`
- Route: `/review/:token`
- Purpose: Verified-visit review: rating, aspects, text, tags, photos with consent, name mode.
- Links to: Account, Standards, Business Profile

### Saved
- File: `BeautyFind Saved.dc.html`
- Route: `/saved`
- Purpose: Saved clinics, compare up to 3 on the same fields.
- Scenario props: `view: list | compare`
- Links to: Search, Account, Directory, Business Profile, Booking

### Search
- File: `BeautyFind Search.dc.html`
- Route: `/search`
- Purpose: Filtered results (region, city, treatment, features, price, languages), list/map, sponsored slot, save hearts.
- Scenario props: `mapView: boolean` · `perLoad: int`

### Treatment Category
- File: `BeautyFind Treatment Category.dc.html`
- Route: `/treatments/:category`
- Purpose: Category explainer, regulation (who may perform), prices, top businesses.
- Scenario props: `category: medical-aesthetics`

### Treatments
- File: `BeautyFind Treatments.dc.html`
- Route: `/treatments`
- Purpose: All 14 categories, who may perform each, median prices.
- Scenario props: `layout: לפי קבוצה | לפי פופולריות` · `responsibility: הכול | רפואי | לא רפואי`

### Unsubscribe
- File: `BeautyFind Unsubscribe.dc.html`
- Route: `/unsubscribe/:token`
- Purpose: Stop marketing per clinic or all, per channel.
- Scenario props: `from: wa | email | sms` · `source: text`
- Links to: Legal, Account


## Client + clinic

### Consult Request
- File: `BeautyFind Consult Request.dc.html`
- Route: `/consult/:branch · /clinic/consults`
- Purpose: Patient consult form; clinic inbox (propose, ask details, decline — medical decline physician-only).
- Scenario props: `side: patient | clinic` · `viewerRole: physician | front` · `consultFee: int`
- Links to: Treatment Category, Account, Business Profile

### Gift Cards
- File: `BeautyFind Gift Cards.dc.html`
- Route: `/gift/:branch · /gift/check · /clinic/gift-cards`
- Purpose: Buy (amount/treatment), check balance, clinic redeem desk + ledger.
- Scenario props: `view: buy | redeem | clinic` · `validityYears: int`
- Links to: Receipt, Booking

### Waitlist
- File: `BeautyFind Waitlist.dc.html`
- Route: `/waitlist/:branch · /w/:token · /clinic/waitlist`
- Purpose: Join, timed slot offer, clinic queue.
- Scenario props: `view: join | offer | clinic` · `holdMinutes: int`


## Shared

### Auth
- File: `BeautyFind Auth.dc.html`
- Route: `/login`
- Purpose: Login/signup (WhatsApp OTP), business login, password reset.
- Links to: Legal, Contact

### Cookie Consent
- File: `BeautyFind Cookie Consent.dc.html`
- Route: `(global component)`
- Purpose: Consent banner + preferences dialog; embedded on public pages.
- Scenario props: `embedded: boolean` · `layout: bar | card`
- Links to: Legal

### Help
- File: `BeautyFind Help.dc.html`
- Route: `/help`
- Purpose: FAQ for clients and businesses with search and topics.
- Scenario props: `audience: client | biz`
- Links to: Contact


## Public

### About
- File: `BeautyFind About.dc.html`
- Route: `/about`
- Purpose: About, editorial policy, methodology.
- Scenario props: `view: about | editorial | methodology`

### Article
- File: `BeautyFind Article.dc.html`
- Route: `/magazine/:slug`
- Purpose: Article template.

### Blog
- File: `BeautyFind Blog.dc.html`
- Route: `/magazine`
- Purpose: Magazine index.
- Scenario props: `showFeatured: boolean`

### Contact
- File: `BeautyFind Contact.dc.html`
- Route: `/contact`
- Purpose: Contact form by reason with response times.
- Scenario props: `reason: general | business | correction | complaint | access | press`

### Legal
- File: `BeautyFind Legal.dc.html`
- Route: `/privacy · /terms · /accessibility`
- Purpose: Privacy, terms, accessibility statement.
- Scenario props: `view: privacy | terms | accessibility`

### Standards
- File: `BeautyFind Standards.dc.html`
- Route: `/listing-standards`
- Purpose: Listing standard and sponsorship rules.
- Scenario props: `view: standards | sponsorship`


## Business

### Branches
- File: `BeautyFind Branches.dc.html`
- Route: `/biz/branches`
- Purpose: Branch switcher, cards, add branch (draft), per-branch billing.
- Scenario props: `price: int`
- Links to: Dashboard, Business Profile

### Claim
- File: `BeautyFind Claim.dc.html`
- Route: `/for-business/claim`
- Purpose: Claim an existing listing (4 steps).

### Dashboard
- File: `BeautyFind Dashboard.dc.html`
- Route: `/biz`
- Purpose: Overview, analytics, profile, menu, reviews, leads CRM, billing, team & permissions.
- Scenario props: `view: overview | analytics | profile | menu | reviews | leads | billing | team` · `role: owner | manager | front | book`
- Links to: Sponsored, Branches, Noa Clinic, Staff Invite

### Get Listed
- File: `BeautyFind Get Listed.dc.html`
- Route: `/for-business`
- Purpose: Business marketing + pricing.
- Scenario props: `price: int` · `billing: monthly | yearly`

### Onboarding
- File: `BeautyFind Onboarding.dc.html`
- Route: `/for-business/join`
- Purpose: 7-step wizard; medical responsibility step only if injectables chosen.
- Links to: Standards, Contact, Dashboard

### Sponsored
- File: `BeautyFind Sponsored.dc.html`
- Route: `/biz/sponsored`
- Purpose: Buy placement (region × category × weeks), preview, wording check; my campaigns.
- Scenario props: `view: buy | manage`
- Links to: Dashboard

### Staff Invite
- File: `BeautyFind Staff Invite.dc.html`
- Route: `/invite/:token`
- Purpose: Accept invite: role summary, details, profession (+license), OTP; expired/used states.
- Scenario props: `inviteState: valid | expired | used` · `role: view | edit | booking | admin`
- Links to: Auth, Legal, Noa Clinic, Dashboard


## Clinic

### Clinic Booking
- File: `BeautyFind Clinic Booking.dc.html`
- Route: `/clinic/booking/:id`
- Purpose: Appointment card: declaration, payment, check-in → treatment → finish, clinical record, log.
- Scenario props: `declaration: signed | flagged | pending` · `viewerRole: physician | front` · `depositOn: boolean` · `depositAmount: int`
- Links to: Noa Clinic, Receipt

### Noa Clinic
- File: `Noa Clinic.dc.html`
- Route: `/clinic`
- Purpose: Clinic back office: calendar, customers, enquiries, messages, tasks, payments, inventory, automations, integrations, settings, log.
- Scenario props: `role: owner | reception | practitioner | accountant` · `clinicalMode: boolean` · `multiBranch: boolean`
- Links to: Dashboard


## Ops

### Admin
- File: `BeautyFind Admin.dc.html`
- Route: `/ops`
- Purpose: Businesses, failed charges, BeautyFind invoices, disputes, sponsored approval.
- Scenario props: `view: biz | billing | disputes | ads`
- Links to: Moderation, Verification

### Moderation
- File: `BeautyFind Moderation.dc.html`
- Route: `/ops/moderation`
- Purpose: Reviews, reports, listing approvals, decision log.

### Verification
- File: `BeautyFind Verification.dc.html`
- Route: `/ops/verification`
- Purpose: License / certificate / claim queue with registry comparison; immutable decisions.
- Scenario props: `reviewer: text`
- Links to: Admin, Moderation


## System

### Design System
- File: `BeautyFind Design System.dc.html`
- Route: `—`
- Purpose: Colors, Hebrew type, components, RTL rules, content policy.

### Emails
- File: `BeautyFind Emails.dc.html`
- Route: `—`
- Purpose: HTML emails: tax invoice, gift card, password reset.
- Scenario props: `template: invoice | gift | reset`
- Links to: Legal, Unsubscribe

### Notifications
- File: `BeautyFind Notifications.dc.html`
- Route: `—`
- Purpose: Message templates (WhatsApp, SMS, email).
- Links to: Noa Clinic

### States
- File: `BeautyFind States.dc.html`
- Route: `—`
- Purpose: 404, no results, empty region, unclaimed, new business, loading, error.
- Links to: Design System, Search, Contact, Region, Get Listed, Claim

