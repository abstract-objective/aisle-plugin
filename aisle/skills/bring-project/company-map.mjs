// The company map (D128 (b), job gc1): the areas a software product company needs, from
// research/plan-gaps/01-company-map.md (APQC PCF 7.4, Porter's value chain, GitLab's handbook,
// Anthropic's knowledge-work plugins), laid on D76's seven departments. Data only; gaps.mjs reads it.
//
// Per area:
//   id, name, dept (one of plan.mjs's DEPT_KEYS), when ('now' or 'later'), first (the 05-first-jobs.md job
//   bring-project offers when the area is missing).
//   words: a job whose title matches one is the area's job (whole words, any case).
//   home:  a Domain or Sub-domain whose title matches one is the area's home. A home names the whole area,
//          not one piece of it ("The name" is one piece of K1, so K1 has no home word).
//   aisle: what AIsle itself gives every project for this area (its goal file, the plan, the walls); an area with
//          no job lives there, not MISSING.
//   touch: a job that only touches the area (02's "for evidence only", "partial").
//   parts: named pieces with their own words; a part with need: true that has no job makes the area MISSING
//          (02: P8's status page, C4's stranger's report, T1's register).
// Every word is taken from the research's words: 01's area names, 02's "where it lives" column, 05's briefs.

export const COMPANY_MAP_VERSION = '2026-10-29';

const W = (...words) => words.map((w) => (w instanceof RegExp ? w : new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')));

export const COMPANY_MAP = Object.freeze({
  version: COMPANY_MAP_VERSION,
  areas: [
    // Management
    { id: 'M1', name: 'goal and vision', dept: 'management', when: 'now', aisle: 'aisle/GOAL.md', home: W('goal re-delivery', /^goal\b/i), words: W('vision') },
    { id: 'M2', name: 'decisions log', dept: 'management', when: 'now', home: W('decisions'), words: W(/\bdecisions? (log|rows?)\b/i, 'waiting rows') },
    { id: 'M3', name: 'metrics read weekly', dept: 'management', when: 'now', home: W('metrics'), words: W('metrics', 'north star', /\bweekly (owner-only )?view\b/i, /\bmeasure D70\b/i, 'counts which nodes') },
    { id: 'M4', name: 'roadmap and priorities', dept: 'management', when: 'now', aisle: 'the plan itself', home: W('roadmap', 'job states'), words: W('roadmap', 'build first') },
    { id: 'M5', name: 'risk register', dept: 'management', when: 'now', first: 'op1', home: W(/\brisks?\b/i), words: W(/\brisks?\b/i, /\bsingle points? of failure\b/i) },
    { id: 'M6', name: 'learning from incidents', dept: 'management', when: 'later', home: W('retros'), words: W(/\bretros?\b/i, 'post-mortem', /\blearn(s|ing)? from (its own )?incidents\b/i, /\bincident reviews?\b/i), touch: W('audit') },
    { id: 'M7', name: 'board and investors', dept: 'management', when: 'later', home: W('investment', 'investors'), words: W(/\binvestors?\b/i, 'raise money') },
    // Product
    { id: 'P1', name: 'product management, the core loop', dept: 'product', when: 'now', aisle: 'the plan itself', home: W('core loop', 'division of work'), words: W('core loop') },
    { id: 'P2', name: 'engineering', dept: 'product', when: 'now', home: W('code home', 'engineering', 'code', 'backend', 'frontend'), words: W('code storage', 'live code', 'architecture', 'code review', 'refactor') },
    { id: 'P3', name: 'testing and quality', dept: 'product', when: 'now', home: W('promises kept', 'testing', /\btests\b/i, 'quality'), words: W('steering cases', /\b(unit|integration|end-to-end) tests?\b/i, 'test suite') },
    { id: 'P4', name: 'design and UX', dept: 'product', when: 'now', home: W('overseer ui', 'first screen', 'design'), words: W('approachable') },
    { id: 'P5', name: 'the website', dept: 'product', when: 'now', first: 'wb1', home: W('website'), words: W('website', 'site', 'first screen', 'AIsle pages', /\bpage list\b/i) },
    { id: 'P6', name: 'docs', dept: 'product', when: 'now', first: 'wb2', home: W('docs'), words: W('quickstart', /\bdocs (site|pages?)\b/i, 'how-to page', 'documentation', /\/aisle\/docs\//i) },
    { id: 'P7', name: 'changelog', dept: 'product', when: 'now', first: 'wb3', home: W('changes', 'releases'), words: W('changes page', 'changelog page', 'release notes', /\/aisle\/changes\//i) },
    {
      id: 'P8', name: 'running the service and a status page', dept: 'product', when: 'now', first: 'wb4', home: W('backups', 'running the service'), words: W(),
      parts: [
        { name: 'backups', words: W(/\bbackups?\b/i, 'restore drill') },
        { name: 'status page and uptime', need: true, words: W('status page', 'uptime', /\/aisle\/status\//i) },
      ],
    },
    {
      id: 'P9', name: 'security', dept: 'product', when: 'now', home: W('security'), words: W('security', 'key refusal', 'sign out everywhere', 'security.txt', /\bvulnerabilit(y|ies)\b/i),
      parts: [{ name: 'threat model', words: W('threat model') }],
    },
    {
      id: 'P10', name: 'product analytics', dept: 'product', when: 'now', home: W('analytics'), words: W('analytics', 'retention', 'counts which nodes', 'count who comes in'),
      parts: [{ name: 'activation funnel', words: W('funnel', 'activation') }],
    },
    { id: 'P11', name: 'integrations', dept: 'product', when: 'now', home: W('other AIs', 'integrations'), words: W('connectors') },
    { id: 'P12', name: 'templates', dept: 'product', when: 'now', home: W('templates'), words: W(/\btemplates?\b/i, /\bstarting maps?\b/i, 'smart experts', 'bring-project', 'bring an existing project') },
    { id: 'P13', name: 'mobile', dept: 'product', when: 'later', home: W('mobile'), words: W('mobile', 'phone pushes', 'on the phone', /\bpush notifications?\b/i) },
    // Marketing & sales
    { id: 'K1', name: 'positioning and name', dept: 'marketing', when: 'now', home: W('positioning', 'brand'), words: W('brand', 'positioning', "AIsle's name", 'displayName', 'AIsle is two things') },
    { id: 'K2', name: 'channels that bring people', dept: 'marketing', when: 'now', home: W('growth'), words: W('channels', 'launch posts') },
    { id: 'K3', name: 'community', dept: 'marketing', when: 'later', first: 'cs4', home: W('community'), words: W('community') },
    { id: 'K4', name: 'pricing', dept: 'marketing', when: 'now', home: W('pricing'), words: W(/\bpric(e|es|ing)\b/i, /\bearn(ing)?\b/i, 'are free', 'free up to') },
    { id: 'K5', name: 'sales', dept: 'marketing', when: 'later', first: 'cs5', home: W('sales'), words: W('sales pipeline', 'outreach', /\bdemos?\b/i) },
    { id: 'K6', name: 'partnerships and marketplaces', dept: 'marketing', when: 'now', home: W('partnerships'), words: W(/\bmarketplaces?\b/i, 'directory', 'Claude Startups', /\bpartnerships?\b/i) },
    // Support
    { id: 'C1', name: 'a support channel', dept: 'support', when: 'now', first: 'cs1', home: W('support', 'help for people'), words: W('support channel', 'ask for help', 'help room', 'reply time') },
    { id: 'C2', name: 'help pages', dept: 'support', when: 'now', first: 'cs2', home: W('help pages', 'help center'), words: W(/\bhelp pages?\b/i, /\bhelp cent(er|re)\b/i, 'knowledge base') },
    { id: 'C3', name: 'onboarding', dept: 'support', when: 'now', home: W('fast start', 'onboarding'), words: W('onboarding', 'first run') },
    {
      id: 'C4', name: "feedback into the plan, a stranger's report", dept: 'support', when: 'now', first: 'cs3', home: W('reports into the plan', 'feedback'), words: W(),
      parts: [
        { name: "a person's own ideas", words: W('low-priority node', 'mid-build ideas', 'reports its own faults') },
        { name: "a stranger's report", need: true, words: W(/\bstranger'?s report\b/i, 'non-member', 'reports into the plan', 'help link') },
      ],
    },
    { id: 'C5', name: 'customer success', dept: 'support', when: 'later', home: W('customer success'), words: W('retention', 'who is stuck', 'who left') },
    // Finance
    { id: 'F1', name: 'books', dept: 'finance', when: 'now', first: 'c13', home: W('books', 'bookkeeping'), words: W('bookkeeping', 'bank account', 'VAT', 'accountant') },
    { id: 'F2', name: 'billing and payments', dept: 'finance', when: 'later', home: W('billing'), words: W('billing and payments', 'merchant of record', 'checkout', /\binvoices?\b/i, /\brefunds?\b/i) },
    {
      id: 'F3', name: 'spend and hard stops', dept: 'finance', when: 'now', home: W('spend'), words: W('spend', /\bbudget\b/i, /\bhard stops?\b/i, 'firepower', 'accounts table'),
      parts: [{ name: "the company's recurring costs in one place", words: W(/\brecurring costs?\b/i, 'COSTS.md') }],
    },
    { id: 'F4', name: 'funding', dept: 'finance', when: 'now', home: W('investment', 'funding'), words: W('funding', /\bgrants?\b/i, 'Claude Startups') },
    { id: 'F5', name: 'unit numbers', dept: 'finance', when: 'later', home: W('proof of savings', 'unit numbers'), words: W('unit numbers', 'cost per user') },
    // Legal
    { id: 'L1', name: 'the legal company', dept: 'legal', when: 'now', home: W('legal company'), words: W('legal company') },
    { id: 'L2', name: 'terms and privacy', dept: 'legal', when: 'now', first: 'lg1', home: W('terms'), words: W('privacy', 'terms') },
    { id: 'L3', name: 'a trust page', dept: 'legal', when: 'now', first: 'wb5', home: W('trust'), words: W('trust page', /\bsubprocessors?\b/i, 'DPA', /\/aisle\/trust\//i) },
    { id: 'L4', name: 'IP and licences', dept: 'legal', when: 'now', home: W('intellectual property'), words: W(/\blicen[cs]es?\b/i, 'trademark', 'registered software mark', 'protect the idea', 'who owns') },
    { id: 'L5', name: "AI vendors' terms", dept: 'legal', when: 'now', home: W('vendor terms'), words: W(/\bvendors?'? terms\b/i, 'terms of service', /\busage polic(y|ies)\b/i), touch: W('Max plans') },
    { id: 'L6', name: 'compliance: export, delete, consent', dept: 'legal', when: 'now', home: W('compliance'), words: W('GDPR', 'consent', 'door out', 'data export') },
    // People
    { id: 'H1', name: 'AI workers', dept: 'people', when: 'now', aisle: 'the AIsle room and its assistants', home: W('autonomy', 'keep going'), words: W('AI workers') },
    { id: 'H2', name: "the founder's time and walls", dept: 'people', when: 'now', aisle: "the plan's walls (blocked jobs a person clears)", home: W('walls'), words: W(/\bwalls?\b/i) },
    { id: 'H3', name: 'team: invite, roles, leave', dept: 'people', when: 'now', home: W('team and roles'), words: W(/\binvites?\b/i, /\broles?\b/i, 'permissions', 'admin layer', 'positions', 'removes a member', 'per-person') },
    { id: 'H4', name: 'hiring', dept: 'people', when: 'later', first: 'op4', home: W('hiring people'), words: W('hiring people', 'hire a person', 'can pay a person') },
    // IT, filed under management or product (01's last group)
    {
      id: 'T1', name: 'accounts register', dept: 'management', when: 'now', first: 'op2', home: W('accounts'), words: W('which Claude account', 'accounts table'),
      parts: [{ name: 'a register of the accounts and keys held', need: true, words: W(/\baccounts? register\b/i, 'ACCOUNTS.md', 'every account') }],
    },
    { id: 'T2', name: 'vendors and costs register', dept: 'management', when: 'now', first: 'op3', home: W('costs'), words: W(/\bvendors?\b/i, /\brecurring costs?\b/i, 'COSTS.md', 'tools and vendors') },
    { id: 'T3', name: "the company's machines", dept: 'management', when: 'now', home: W('machines'), words: W(/\bPCs?\b/, 'laptop', 'CPU') },
  ],
});

// The first job bring-project offers for a missing now-area (D128 (b)): research/plan-gaps/05-first-jobs.md's
// job for that area (its id in `from`), in words for any project, added only on the person's yes and as optional
// until kept. An area 05 gave no job is named, with no job offered.
export const FIRST_JOBS = Object.freeze({
  P5: { from: 'wb1', type: 'feature', hours: '2-4', title: 'The website: every page people land on, with the job that keeps it and its one-line promise', doneWhen: 'a list names every page the site builds, and a test fails on a page it does not name' },
  P6: { from: 'wb2', type: 'feature', hours: '4-6', title: 'Docs: a quickstart and one how-to page for each step people get stuck on', doneWhen: 'a newcomer answers the first-run questions from the docs alone' },
  P7: { from: 'wb3', type: 'feature', hours: '2', title: 'A changes page: one plain line per release, newest first', doneWhen: 'the build fails when a release has no line' },
  P8: { from: 'wb4', type: 'feature', hours: '3', title: 'A status page: whether the service is up, and the last incidents, one line each', doneWhen: 'the page reads the health check, and says an outside monitor is a person\'s account to open' },
  L2: { from: 'lg1', type: 'chore', hours: '2', title: 'Terms and privacy in one list: every promise the privacy page and the terms make, with the job that keeps it', doneWhen: 'a test fails on a privacy sentence with no line' },
  L3: { from: 'wb5', type: 'feature', hours: '3', title: 'A trust page: what is kept and how long, where it runs, the outside services, how to report a security problem', doneWhen: 'each line matches the privacy page\'s own sentence' },
  C1: { from: 'cs1', type: 'feature', hours: '2', title: 'One way to ask for help, on every page, with the reply time said', doneWhen: 'the help address or room is linked from the first page and the docs' },
  C2: { from: 'cs2', type: 'chore', hours: '3', title: 'Help pages from solved problems: a problem hit twice gets a short page', doneWhen: 'each help page names the fix it came from' },
  C4: { from: 'cs3', type: 'feature', hours: '3', title: "A stranger's report reaches the plan: from the help link to one line filed as a bug or an optional job", doneWhen: 'a report from a non-member lands as a job, and the sender is told it arrived' },
  F1: { from: 'c13', type: 'chore', hours: '1', title: 'Books once the company exists: a bank account, bookkeeping and tax, with costs and hard stops said first', doneWhen: 'the options and their yearly costs are written; a person opens the accounts' },
  M5: { from: 'op1', type: 'chore', hours: '1', title: 'A risk list: what could stop the project (one machine, one person, one account, a leaked key), each with the job that lowers it', doneWhen: 'every risk names a job, or says accepted with the reason' },
  T1: { from: 'op2', type: 'chore', hours: '1', title: 'An accounts register: each account the project holds, who holds it, its renewal and recovery place, never a secret', doneWhen: 'a check refuses a key-shaped string in it' },
  T2: { from: 'op3', type: 'chore', hours: '1', title: 'Recurring costs: each with its monthly cost, renewal and hard stop or "none"', doneWhen: 'the monthly total is written' },
});

// The seven departments' names (plan.mjs's DEPARTMENTS), for the Domain line a first job goes under.
export const DEPT_NAMES = Object.freeze({ management: 'Management', product: 'Product', marketing: 'Marketing & Sales', finance: 'Finance', legal: 'Legal', people: 'HR / AI / People', support: 'Customer Success / Support' });
