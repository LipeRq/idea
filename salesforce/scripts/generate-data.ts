// 架空データの生成: npm run generate-data(node scripts/generate-data.ts)
//   data/ec/*.csv, data/pos/*.csv, data/engagement/*.csv   Data 360 に取り込むデータ
//   data/crm/*.json                                        Sales Cloud に入れる法人のデータ(sf data import tree 用)
//   data360/ingestion-api-schema.yaml                      Ingestion API コネクタに登録するスキーマ
//   scripts/apex/seed-products.apex                        商品と標準価格を登録する匿名 Apex
//   data/README.md                                         件数と、名寄せ・セグメントの人数の期待値(検算用)
// 乱数の種と基準日(2026-10-31)を固定しているので、何度実行しても同じ内容になる。
// --check を付けると、ファイルを書かずに、コミット済みのファイルと一致するかだけを確かめる(CI 用)。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATEGORY_LABEL,
  FREE_SHIPPING_THRESHOLD,
  OCCASION_LABEL,
  PRODUCTS,
  SHIPPING_FEE,
  SHOP_URL,
  imageUrl,
  productUrl,
  type Category,
  type Occasion,
  type Product,
} from "./lib/catalog.ts";
import {
  ACCOUNT_COMPANIES,
  CONTACT_TITLES,
  GIVEN_NAMES,
  KANJI_VARIANTS,
  LEAD_COMPANIES,
  PERSONAL_DOMAINS,
  PREFECTURES,
  PROSPECT_COMPANIES,
  ROLE_LOCAL_PARTS,
  SURNAMES,
  type Company,
  type NamePart,
  type Surname,
} from "./lib/people.ts";
import { createRandom } from "./lib/random.ts";
import { TABLES, ingestionSchemaYaml, toCsv, type TableDef } from "./lib/tables.ts";
import { DAY, daysBetween, iso, jst, jstDate, jstParts, startOfJstDay } from "./lib/time.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED = 20261103;
const START = jst(2024, 11, 1);
const AS_OF = jst(2026, 10, 31, 23, 59);
const WEB_FROM = jst(2026, 8, 2);
const EMAIL_FROM = jst(2026, 8, 1);
const N_EC = 1200;

const r = createRandom(SEED);
const outputs = new Map<string, string>();

// ---------------------------------------------------------------- 共通

interface Person {
  last: Surname;
  first: NamePart;
  phone: string;
}

const usedPhones = new Set<string>();
function newPhone(): string {
  for (;;) {
    const phone = `${r.pick(["090", "080", "070"])}-0${r.int(100, 999)}-${r.int(1000, 9999)}`;
    if (!usedPhones.has(phone)) {
      usedPhones.add(phone);
      return phone;
    }
  }
}

function newPerson(): Person {
  return { last: r.pick(SURNAMES), first: r.weighted(GIVEN_NAMES), phone: newPhone() };
}

const usedEmails = new Set<string>();
function uniqueEmail(local: string, domain: string): string {
  let candidate = `${local}@${domain}`;
  for (let i = 2; usedEmails.has(candidate); i++) candidate = `${local}${i}@${domain}`;
  usedEmails.add(candidate);
  return candidate;
}

function personalEmail(person: Person): string {
  const style = r.int(0, 2);
  const local =
    style === 0
      ? `${person.first.romaji}.${person.last.romaji}`
      : style === 1
        ? `${person.last.romaji}${person.first.romaji[0]}${r.int(10, 99)}`
        : `${person.first.romaji}${r.int(100, 999)}`;
  return uniqueEmail(local, r.pick(PERSONAL_DOMAINS));
}

function companyEmail(person: Person, company: Company): string {
  return uniqueEmail(`${person.last.romaji}.${person.first.romaji}`, `${company.slug}.example`);
}

/** from〜to の間の日時。時刻は hourFrom 時〜hourTo 時(日本時間) */
function randomTime(from: number, to: number, hourFrom = 7, hourTo = 23): number {
  const days = Math.max(0, daysBetween(from, to));
  for (let i = 0; i < 50; i++) {
    const t = startOfJstDay(from) + r.int(0, days) * DAY + r.int(hourFrom * 60, hourTo * 60 - 1) * 60_000;
    if (t >= from && t <= to) return t;
  }
  return Math.min(Math.max(from, START), to);
}

const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
const pad = (x: number, width: number) => String(x).padStart(width, "0");
const digits = (phone: string) => phone.replace(/\D/g, "");
const yen = (x: number) => `${x.toLocaleString("en-US")}円`;

function write(relPath: string, content: string) {
  outputs.set(relPath, content);
}

function writeTable(table: TableDef, rows: Record<string, string | number | boolean | null>[]) {
  write(path.join("data", table.file), toCsv(table, rows));
}

// ---------------------------------------------------------------- ギフトの時期

interface GiftWindow {
  occasion: Occasion;
  year: number;
  start: number;
  end: number;
}

const GIFT_WINDOWS: GiftWindow[] = [
  { occasion: "Oseibo", year: 2024, start: jst(2024, 11, 20), end: jst(2024, 12, 20, 23, 59) },
  { occasion: "Ochugen", year: 2025, start: jst(2025, 6, 15), end: jst(2025, 7, 15, 23, 59) },
  { occasion: "Oseibo", year: 2025, start: jst(2025, 11, 20), end: jst(2025, 12, 20, 23, 59) },
  { occasion: "Ochugen", year: 2026, start: jst(2026, 6, 15), end: jst(2026, 7, 15, 23, 59) },
];
const windowAt = (t: number) => GIFT_WINDOWS.find((w) => t >= w.start && t <= w.end);

// ---------------------------------------------------------------- EC 会員と注文

type CompanyKind = "account" | "lead" | "prospect";

interface EcCustomer {
  memberId: string;
  person: Person;
  email: string;
  prefecture: string;
  birthYear: number | null;
  registeredAt: number;
  favorite: Category;
  decaf: boolean;
  giftBuyer: boolean;
  giftBudget: number;
  bigGift: boolean;
  companyKind: CompanyKind | null;
  company: Company | null;
  meanGap: number;
  openRate: number;
  badEmail: boolean;
  optInInitial: boolean;
  optOutAt: number | null;
  willPurchase: boolean;
}

interface Line {
  product: Product;
  qty: number;
}

interface Order {
  orderId: string;
  customer: EcCustomer;
  at: number;
  isGift: boolean;
  occasion: Occasion | null;
  destinations: number;
  noshi: boolean;
  lines: Line[];
  coupon: string | null;
  cancelled: boolean;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
}

// 登録の多さ:後の月ほど多く(1.0→2.0 倍)、ギフトの時期(6・7・11・12 月)は 1.3 倍
const MONTHS = Array.from({ length: 24 }, (_, i) => {
  const y = 2024 + Math.floor((10 + i) / 12);
  const m = ((10 + i) % 12) + 1;
  const start = jst(y, m, 1);
  const next = m === 12 ? jst(y + 1, 1, 1) : jst(y, m + 1, 1);
  const season = [6, 7, 11, 12].includes(m) ? 1.3 : 1;
  return [{ start, end: Math.min(next - 60_000, AS_OF) }, (1 + i / 23) * season] as const;
});

const TEA_CATEGORIES: Category[] = ["Sencha", "Gyokuro", "Matcha", "Hojicha", "Wakoucha"];
const selfProducts = PRODUCTS.filter((x) => x.category !== "GiftSet" && x.category !== "Teaware");
const decafProducts = selfProducts.filter((x) => x.caffeine === "Low");
const teaware = PRODUCTS.filter((x) => x.category === "Teaware");

const companyPool: Record<CompanyKind, Company[]> = {
  account: ACCOUNT_COMPANIES,
  lead: LEAD_COMPANIES,
  prospect: PROSPECT_COMPANIES,
};

const ecDrafts: EcCustomer[] = [];
for (let i = 0; i < N_EC; i++) {
  const person = newPerson();
  const month = r.weighted(MONTHS);
  const giftBuyer = r.chance(0.32);
  const bigGift = giftBuyer && r.chance(0.14);
  const companyKind: CompanyKind | null =
    bigGift && r.chance(0.6)
      ? r.weighted([
          ["account", 4],
          ["lead", 2.5],
          ["prospect", 3.5],
        ] as const)
      : null;
  const company = companyKind ? r.pick(companyPool[companyKind]) : null;
  ecDrafts.push({
    memberId: "",
    person,
    email: company ? companyEmail(person, company) : personalEmail(person),
    prefecture: r.weighted(PREFECTURES),
    birthYear: r.chance(0.75) ? Math.round(Math.min(2004, Math.max(1945, r.normal(1975, 11)))) : null,
    registeredAt: randomTime(month.start, month.end),
    favorite: r.weighted([
      ["Sencha", 35],
      ["Hojicha", 18],
      ["Matcha", 15],
      ["Wakoucha", 12],
      ["Gyokuro", 8],
    ] as const),
    decaf: r.chance(0.1),
    giftBuyer,
    giftBudget: r.weighted([
      [2000, 2],
      [3000, 4],
      [4000, 3],
      [6000, 2],
      [11000, 1],
    ] as const),
    bigGift,
    companyKind,
    company,
    meanGap: r.weighted([
      [45, 2],
      [75, 3],
      [120, 3],
      [180, 2],
    ] as const),
    openRate: r.weighted([
      [0.03, 2],
      [0.12, 3],
      [0.25, 3],
      [0.45, 2],
      [0.65, 1],
    ] as const),
    badEmail: r.chance(0.015),
    optInInitial: r.chance(0.72),
    optOutAt: null,
    willPurchase: r.chance(0.88),
  });
}
ecDrafts.sort((a, b) => a.registeredAt - b.registeredAt);
ecDrafts.forEach((c, i) => (c.memberId = `EC-${pad(i + 1, 6)}`));
const ecCustomers = ecDrafts;

function selfLines(c: EcCustomer): Line[] {
  const lines: Line[] = [];
  const count = r.weighted([
    [1, 5],
    [2, 3],
    [3, 1],
  ] as const);
  for (let i = 0; i < count; i++) {
    let product: Product;
    const roll = r.next();
    if (c.decaf) product = r.pick(decafProducts);
    else if (roll < 0.7) product = r.pick(selfProducts.filter((x) => x.category === c.favorite));
    else if (roll < 0.95) product = r.pick(selfProducts);
    else product = r.pick(teaware);
    const existing = lines.find((x) => x.product.id === product.id);
    if (existing) continue;
    const qty =
      product.category === "Teaware"
        ? 1
        : r.weighted([
            [1, 14],
            [2, 5],
            [3, 1],
          ] as const);
    lines.push({ product, qty });
  }
  return lines;
}

function giftLines(occasion: Occasion, destinations: number, budget: number): Line[] {
  const candidates = PRODUCTS.filter((x) => x.giftEligible && x.occasions.includes(occasion));
  const affordable = candidates.filter((x) => x.price <= budget * 1.2);
  const pool = affordable.length > 0 ? affordable : [candidates.reduce((a, x) => (x.price < a.price ? x : a))];
  const first = r.pick(pool);
  if (destinations >= 2 && r.chance(0.2)) {
    const second = r.pick(pool);
    if (second.id !== first.id) {
      const half = Math.ceil(destinations / 2);
      return [
        { product: first, qty: half },
        { product: second, qty: destinations - half },
      ];
    }
  }
  return [{ product: first, qty: destinations }];
}

const orderDrafts: Order[] = [];
function addOrder(
  c: EcCustomer,
  at: number,
  gift: { occasion: Occasion } | null,
  coupon: string | null = null,
): void {
  const destinations = gift
    ? c.bigGift
      ? r.int(10, 40)
      : r.weighted([
          [1, 5],
          [2, 3],
          [3, 2],
          [5, 1],
        ] as const)
    : 1;
  const lines = gift ? giftLines(gift.occasion, destinations, c.giftBudget) : selfLines(c);
  const subtotal = sum(lines.map((x) => x.qty * x.product.price));
  const shipping = subtotal / destinations >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE * destinations;
  const discount = coupon ? Math.floor(subtotal * 0.1) : 0;
  orderDrafts.push({
    orderId: "",
    customer: c,
    at,
    isGift: gift !== null,
    occasion: gift?.occasion ?? null,
    destinations,
    noshi: gift !== null && lines.every((x) => x.product.noshi) && gift.occasion !== "Novelty" && r.chance(0.75),
    lines,
    coupon,
    cancelled: r.chance(0.02),
    subtotal,
    shipping,
    discount,
    total: subtotal + shipping - discount,
  });
}

for (const c of ecCustomers) {
  if (!c.willPurchase) continue;
  let t = c.registeredAt + r.int(1, 30) * 60_000;
  const firstWindow = windowAt(t);
  addOrder(c, t, c.giftBuyer && firstWindow ? { occasion: firstWindow.occasion } : null);
  // 2 回目を買う確率は 42%、3 回目以降は 78%(初回だけで離れる人が多い D2C を想定)
  let continueRate = 0.42;
  for (let n = 2; ; n++) {
    if (!r.chance(continueRate)) break;
    const gapDays = Math.max(7, Math.round(-c.meanGap * Math.log(1 - r.next())));
    t = randomTime(t + gapDays * DAY, t + gapDays * DAY);
    if (t > AS_OF) break;
    addOrder(c, t, null, n === 2 && r.chance(0.35) ? "WELCOME2" : null);
    continueRate = 0.78;
  }
  if (c.giftBuyer) {
    for (const w of GIFT_WINDOWS) {
      if (w.end < c.registeredAt || windowAt(c.registeredAt) === w) continue;
      if (r.chance(0.55)) addOrder(c, randomTime(Math.max(w.start, c.registeredAt), w.end), { occasion: w.occasion });
    }
    if (r.chance(0.2)) {
      addOrder(c, randomTime(c.registeredAt, AS_OF), { occasion: r.pick(["Uchiiwai", "Anniversary"] as const) });
    }
  }
}
orderDrafts.sort((a, b) => a.at - b.at || a.customer.memberId.localeCompare(b.customer.memberId));
orderDrafts.forEach((o, i) => (o.orderId = `O-${pad(i + 1, 7)}`));
const orders = orderDrafts;
const completedOrders = orders.filter((o) => !o.cancelled);

// ---------------------------------------------------------------- 店舗会員と店舗購買

type PosKind = "same_email" | "name_phone" | "linked" | "old_email" | "store_only" | "family";

interface PosMember {
  cardNo: string;
  kind: PosKind;
  lastName: string;
  firstName: string;
  lastKana: string;
  firstKana: string;
  email: string | null;
  phone: string;
  linked: string | null;
  optIn: boolean;
  homeStore: string;
  joinedAt: number;
  /** 正解(同じ人の EC 会員)。検算にだけ使い、CSV には出さない */
  ec: EcCustomer | null;
}

const purchased = ecCustomers.filter((c) => c.willPurchase && c.companyKind === null);
const overlap = r.sample(purchased, 210);
const overlapIds = new Set(overlap.map((c) => c.memberId));

function variantSurname(last: Surname, p: number): string {
  return last.variant && r.chance(p) ? last.variant : last.kanji;
}

function phoneVariant(phone: string): string {
  const d = digits(phone);
  return r.pick([d, `+81-${phone.slice(1)}`, phone.replace(/-/g, " ")]);
}

function emailVariant(email: string): string {
  const [local, domain] = email.split("@");
  const upper = local.charAt(0).toUpperCase() + local.slice(1);
  return `${upper}@${r.chance(0.3) ? domain.toUpperCase() : domain}${r.chance(0.3) ? " " : ""}`;
}

const posDrafts: PosMember[] = [];
const joinTime = () => randomTime(START - 200 * DAY, AS_OF - 20 * DAY, 10, 19);
const homeStore = () =>
  r.weighted([
    ["S01", 6],
    ["S02", 4],
  ] as const);

for (const c of overlap) {
  const kind = r.weighted([
    ["same_email", 40],
    ["name_phone", 35],
    ["linked", 15],
    ["old_email", 10],
  ] as const);
  const p = c.person;
  const base = {
    kind,
    firstName: p.first.kanji,
    lastKana: p.last.kana,
    firstKana: p.first.kana,
    homeStore: homeStore(),
    joinedAt: joinTime(),
    ec: c,
    cardNo: "",
  };
  if (kind === "same_email") {
    posDrafts.push({
      ...base,
      lastName: variantSurname(p.last, 0.3),
      email: emailVariant(c.email),
      phone: digits(p.phone),
      linked: null,
      optIn: r.chance(0.5),
    });
  } else if (kind === "name_phone") {
    posDrafts.push({
      ...base,
      lastName: variantSurname(p.last, 0.8),
      email: null,
      phone: phoneVariant(p.phone),
      linked: null,
      optIn: false,
    });
  } else if (kind === "linked") {
    posDrafts.push({
      ...base,
      lastName: p.last.kanji,
      email: r.chance(0.5) ? c.email : null,
      phone: p.phone,
      linked: c.memberId,
      optIn: false,
    });
  } else {
    posDrafts.push({
      ...base,
      lastName: variantSurname(p.last, 0.5),
      email: personalEmail(p),
      phone: p.phone,
      linked: null,
      optIn: r.chance(0.5),
    });
  }
}

for (let i = 0; i < 140; i++) {
  const p = newPerson();
  const email = r.chance(0.5) ? personalEmail(p) : null;
  posDrafts.push({
    kind: "store_only",
    cardNo: "",
    lastName: p.last.kanji,
    firstName: p.first.kanji,
    lastKana: p.last.kana,
    firstKana: p.first.kana,
    email,
    phone: r.chance(0.5) ? p.phone : digits(p.phone),
    linked: null,
    optIn: email !== null && r.chance(0.5),
    homeStore: homeStore(),
    joinedAt: joinTime(),
    ec: null,
  });
}

// 家族:EC 会員と同じ電話番号・同じ姓で、名が違う人(電話番号だけで名寄せすると、別の人がまとまってしまう)
for (const c of r.sample(
  purchased.filter((x) => !overlapIds.has(x.memberId)),
  20,
)) {
  let first = r.weighted(GIVEN_NAMES);
  while (first.kanji === c.person.first.kanji) first = r.weighted(GIVEN_NAMES);
  posDrafts.push({
    kind: "family",
    cardNo: "",
    lastName: c.person.last.kanji,
    firstName: first.kanji,
    lastKana: c.person.last.kana,
    firstKana: first.kana,
    email: null,
    phone: r.chance(0.5) ? c.person.phone : digits(c.person.phone),
    linked: null,
    optIn: false,
    homeStore: homeStore(),
    joinedAt: joinTime(),
    ec: null,
  });
}
posDrafts.sort((a, b) => a.joinedAt - b.joinedAt);
posDrafts.forEach((m, i) => (m.cardNo = `POS-${pad(i + 1, 6)}`));
const posMembers = posDrafts;

interface PosTransaction {
  transactionId: string;
  member: PosMember;
  store: string;
  at: number;
  lines: Line[];
  total: number;
}

const posTxDrafts: PosTransaction[] = [];
for (const m of posMembers) {
  const count = r.weighted([
    [1, 30],
    [2, 25],
    [3, 18],
    [4, 12],
    [6, 8],
    [8, 7],
  ] as const);
  for (let i = 0; i < count; i++) {
    const at = randomTime(Math.max(START, m.joinedAt), AS_OF, 10, 19);
    const w = windowAt(at);
    const lines: Line[] = [];
    for (let j = r.int(1, 3); j > 0; j--) {
      const roll = r.next();
      const product =
        w && roll < 0.3
          ? r.pick(PRODUCTS.filter((x) => x.category === "GiftSet" && x.occasions.includes(w.occasion)))
          : roll < 0.9
            ? r.pick(selfProducts)
            : r.pick(teaware);
      if (lines.some((x) => x.product.id === product.id)) continue;
      lines.push({ product, qty: product.category === "Teaware" ? 1 : r.int(1, 2) });
    }
    posTxDrafts.push({
      transactionId: "",
      member: m,
      store: r.chance(0.85) ? m.homeStore : m.homeStore === "S01" ? "S02" : "S01",
      at,
      lines,
      total: sum(lines.map((x) => x.qty * x.product.price)),
    });
  }
}
posTxDrafts.sort((a, b) => a.at - b.at || a.member.cardNo.localeCompare(b.member.cardNo));
posTxDrafts.forEach((t, i) => (t.transactionId = `T-${pad(i + 1, 7)}`));
const posTransactions = posTxDrafts;

// ---------------------------------------------------------------- Sales Cloud(法人)

interface AccountRec {
  ref: string;
  company: Company;
  phone: string;
  prefecture: string;
  employees: number;
  sharedAddress: boolean;
}

const AREAS: (readonly [{ code: string; prefecture: string }, number])[] = [
  [{ code: "03", prefecture: "東京都" }, 8],
  [{ code: "06", prefecture: "大阪府" }, 3],
  [{ code: "045", prefecture: "神奈川県" }, 2],
  [{ code: "052", prefecture: "愛知県" }, 2],
  [{ code: "092", prefecture: "福岡県" }, 1],
  [{ code: "011", prefecture: "北海道" }, 1],
];

function landline(): { phone: string; prefecture: string } {
  const area = r.weighted(AREAS);
  const phone =
    area.code.length === 2
      ? `${area.code}-0${r.int(100, 999)}-${r.int(1000, 9999)}`
      : `${area.code}-0${r.int(10, 99)}-${r.int(1000, 9999)}`;
  return { phone, prefecture: area.prefecture };
}

const accounts: AccountRec[] = ACCOUNT_COMPANIES.map((company, i) => {
  const line = landline();
  return {
    ref: `AccountRef${i + 1}`,
    company,
    phone: line.phone,
    prefecture: line.prefecture,
    employees: r.pick([12, 18, 25, 40, 60, 85, 120, 180, 250, 400]),
    sharedAddress: false,
  };
});
const accountByCompany = new Map(accounts.map((a) => [a.company.slug, a]));

interface ContactRec {
  ref: string;
  account: AccountRec;
  person: Person;
  email: string;
  mobile: string | null;
  department: string;
  title: string;
  /** 正解(同じ人の EC 会員)。検算にだけ使う */
  ec: EcCustomer | null;
}

const contacts: ContactRec[] = [];
function addContact(account: AccountRec, person: Person, email: string, mobile: string | null, ec: EcCustomer | null) {
  const role = r.weighted(CONTACT_TITLES);
  contacts.push({
    ref: `ContactRef${contacts.length + 1}`,
    account,
    person,
    email,
    mobile,
    department: role.department,
    title: role.title,
    ec,
  });
}

for (const a of accounts) {
  const count = r.weighted([
    [1, 5],
    [2, 4],
    [3, 1],
  ] as const);
  for (let i = 0; i < count; i++) {
    const p = newPerson();
    addContact(a, p, companyEmail(p, a.company), r.chance(0.5) ? p.phone : null, null);
  }
}
// 会社のアドレスで EC を使っている人のうち、取引先の担当者でもある人(メールアドレスが同じ)
for (const c of ecCustomers.filter((x) => x.companyKind === "account")) {
  addContact(accountByCompany.get(c.company!.slug)!, c.person, c.email, r.chance(0.5) ? c.person.phone : null, c);
}
// 個人のアドレスで EC を使っている人のうち、取引先の担当者でもある人(氏名と携帯電話が同じ)
const personalMatches = r.sample(
  purchased.filter((c) => !overlapIds.has(c.memberId)),
  8,
);
for (const c of personalMatches) {
  const a = r.pick(accounts);
  addContact(a, c.person, companyEmail(c.person, a.company), digits(c.person.phone), c);
}
// 総務部の共有アドレスを、2 人が連絡先として登録している会社(メールアドレスだけで名寄せすると、別の人がまとまってしまう)
for (const a of r.sample(accounts, 2)) {
  a.sharedAddress = true;
  for (let i = 0; i < 2; i++) {
    const p = newPerson();
    addContact(a, p, `soumu@${a.company.slug}.example`, r.chance(0.5) ? p.phone : null, null);
  }
}

interface OpportunityRec {
  ref: string;
  account: AccountRec;
  name: string;
  occasion: Occasion;
  stage: string;
  closeDate: string;
  amount: number;
  quantity: number;
  deliveryDate: string;
  isRepeat: boolean;
}

const OPEN_STAGES: (readonly [string, number])[] = [
  ["Prospecting", 3],
  ["Qualification", 3],
  ["Proposal/Price Quote", 2.5],
  ["Negotiation/Review", 1.5],
];

const opportunities: OpportunityRec[] = [];
const SEASONS: { occasion: Occasion; year: number; closeFrom: number; closeTo: number; deliverFrom: number }[] = [
  { occasion: "Oseibo", year: 2024, closeFrom: jst(2024, 11, 5), closeTo: jst(2024, 12, 5), deliverFrom: jst(2024, 12, 1) },
  { occasion: "Ochugen", year: 2025, closeFrom: jst(2025, 5, 25), closeTo: jst(2025, 6, 25), deliverFrom: jst(2025, 7, 1) },
  { occasion: "Oseibo", year: 2025, closeFrom: jst(2025, 11, 5), closeTo: jst(2025, 12, 5), deliverFrom: jst(2025, 12, 1) },
  { occasion: "Ochugen", year: 2026, closeFrom: jst(2026, 5, 25), closeTo: jst(2026, 6, 25), deliverFrom: jst(2026, 7, 1) },
  { occasion: "Oseibo", year: 2026, closeFrom: jst(2026, 11, 5), closeTo: jst(2026, 12, 5), deliverFrom: jst(2026, 12, 1) },
];

for (const a of accounts) {
  const oseiboRate = r.chance(0.75) ? 0.9 : 0.3;
  const ochugenRate = r.chance(0.5) ? 0.85 : 0.2;
  const baseQty = r.int(20, 300);
  const unit = r.pick([2160, 2700, 3240, 3780, 4320, 5400]);
  const wonBefore = new Set<string>();
  for (const s of SEASONS) {
    if (!r.chance(s.occasion === "Oseibo" ? oseiboRate : ochugenRate)) continue;
    const isRepeat = wonBefore.has(s.occasion);
    const quantity = Math.max(10, Math.round(baseQty * r.between(0.8, 1.2)));
    let closeAt = randomTime(s.closeFrom, s.closeTo, 9, 18);
    let stage: string;
    if (closeAt <= AS_OF) {
      stage = r.chance(isRepeat ? 0.85 : s.year === 2024 ? 0.6 : 0.45) ? "Closed Won" : "Closed Lost";
    } else if (r.chance(isRepeat ? 0.25 : 0.08)) {
      // 早めに決まった今年のお歳暮
      stage = "Closed Won";
      closeAt = randomTime(jst(2026, 10, 1), AS_OF, 9, 18);
    } else {
      stage = r.weighted(OPEN_STAGES);
    }
    if (stage === "Closed Won") wonBefore.add(s.occasion);
    opportunities.push({
      ref: `OpportunityRef${opportunities.length + 1}`,
      account: a,
      name: `${a.company.short} ${s.year}${OCCASION_LABEL[s.occasion]}`,
      occasion: s.occasion,
      stage,
      closeDate: jstDate(closeAt),
      amount: quantity * unit,
      quantity,
      deliveryDate: jstDate(randomTime(s.deliverFrom, s.deliverFrom + 19 * DAY, 9, 18)),
      isRepeat,
    });
  }
  for (const occasion of ["Anniversary", "Novelty"] as const) {
    if (!r.chance(0.15)) continue;
    const closeAt = randomTime(START, AS_OF, 9, 18);
    const quantity = r.int(30, 500);
    const won = r.chance(0.55);
    opportunities.push({
      ref: `OpportunityRef${opportunities.length + 1}`,
      account: a,
      name: `${a.company.short} ${jstParts(closeAt).y}${OCCASION_LABEL[occasion]}`,
      occasion,
      stage: won ? "Closed Won" : "Closed Lost",
      closeDate: jstDate(closeAt),
      amount: quantity * (occasion === "Novelty" ? r.pick([540, 1620, 2160]) : r.pick([2700, 3240, 5400])),
      quantity,
      deliveryDate: jstDate(closeAt + r.int(14, 30) * DAY),
      isRepeat: false,
    });
  }
}

interface LeadRec {
  company: Company;
  person: Person;
  email: string;
  phone: string;
  quantity: number;
  budget: number;
  occasion: Occasion;
  desiredDate: string;
  channel: string;
  inquiryAt: number;
  summary: string;
  ec: EcCustomer | null;
}

function occasionForMonth(month: number): Occasion {
  if (month >= 5 && month <= 7) return r.chance(0.7) ? "Ochugen" : r.pick(["Anniversary", "Novelty"] as const);
  if (month >= 9) return r.chance(0.75) ? "Oseibo" : r.pick(["Anniversary", "Novelty", "Uchiiwai"] as const);
  return r.pick(["Anniversary", "Novelty", "Uchiiwai"] as const);
}

function desiredDate(occasion: Occasion, inquiryAt: number): string {
  const { y } = jstParts(inquiryAt);
  if (occasion === "Ochugen") return jstDate(jst(y, 7, r.int(1, 15)));
  if (occasion === "Oseibo") return jstDate(jst(y, 12, r.int(1, 20)));
  return jstDate(inquiryAt + r.int(21, 60) * DAY);
}

const leads: LeadRec[] = [];
function addLead(company: Company, person: Person, email: string, ec: EcCustomer | null) {
  const inquiryAt = randomTime(jst(2026, 5, 1), AS_OF, 9, 20);
  const occasion = occasionForMonth(jstParts(inquiryAt).m);
  const quantity = occasion === "Novelty" ? r.int(50, 500) : r.int(10, 150);
  const budget =
    occasion === "Novelty"
      ? r.pick([540, 1000, 1620])
      : r.pick([2000, 3000, 3240, 5000, 5400]);
  const channel =
    inquiryAt >= jst(2026, 8, 1) && r.chance(0.3)
      ? "Agentforce"
      : r.weighted([
          ["WebForm", 5],
          ["Phone", 3],
          ["Email", 2],
        ] as const);
  const noshi = occasion === "Novelty" ? "のし不要" : "のし希望";
  leads.push({
    company,
    person,
    email,
    phone: r.chance(0.5) ? person.phone : landline().phone,
    quantity,
    budget,
    occasion,
    desiredDate: desiredDate(occasion, inquiryAt),
    channel,
    inquiryAt,
    summary: `${OCCASION_LABEL[occasion]}として${quantity}件。1件あたり${yen(budget)}程度。${noshi}。`,
    ec,
  });
}
for (const company of LEAD_COMPANIES) {
  for (let i = r.weighted([
    [1, 3],
    [2, 1],
  ] as const); i > 0; i--) {
    const p = newPerson();
    addLead(company, p, companyEmail(p, company), null);
  }
}
for (const c of ecCustomers.filter((x) => x.companyKind === "lead")) {
  addLead(c.company!, c.person, c.email, c);
}
leads.sort((a, b) => a.inquiryAt - b.inquiryAt);

// ---------------------------------------------------------------- メールの反応(直近 3 か月)

interface EmailEvent {
  key: string;
  name: string;
  type: "sent" | "open" | "click" | "bounce" | "unsubscribe";
  url: string | null;
  at: number;
}

const emailEvents: EmailEvent[] = [];
const bounced = new Set<string>();
const sends: { c: EcCustomer; name: string; at: number }[] = [];
for (let t = jst(2026, 8, 7, 18); t <= AS_OF; t += 14 * DAY) {
  const name = `NL_${jstDate(t).replace(/-/g, "")}`;
  for (const c of ecCustomers) if (c.registeredAt < t) sends.push({ c, name, at: t + r.int(0, 20) * 60_000 });
}
// ウェルカムのジャーニー(初回購入の 1 時間後・7 日後・14 日後。14 日後は 2 回目を買っていない人だけ)
const ordersByCustomer = new Map<string, Order[]>();
for (const o of completedOrders) {
  const list = ordersByCustomer.get(o.customer.memberId) ?? [];
  list.push(o);
  ordersByCustomer.set(o.customer.memberId, list);
}
for (const c of ecCustomers) {
  const list = ordersByCustomer.get(c.memberId);
  if (!list) continue;
  const first = list[0].at;
  const second = list[1]?.at ?? Infinity;
  const steps: [string, number][] = [
    ["JB_WELCOME_D0_THANKS", first + 60 * 60_000],
    ["JB_WELCOME_D7_REVIEW", startOfJstDay(first) + 7 * DAY + 10 * 60 * 60_000],
  ];
  const d14 = startOfJstDay(first) + 14 * DAY + 10 * 60 * 60_000;
  if (second > d14) steps.push(["JB_WELCOME_D14_RECO", d14]);
  for (const [name, at] of steps) if (at >= EMAIL_FROM && at <= AS_OF) sends.push({ c, name, at });
}
sends.sort((a, b) => a.at - b.at || a.c.memberId.localeCompare(b.c.memberId));

const linkFor = (c: EcCustomer, name: string) => {
  if (name.includes("REVIEW")) return `${SHOP_URL}/mypage/reviews`;
  const product = r.pick(selfProducts.filter((x) => x.category === c.favorite));
  return productUrl(product);
};

for (const s of sends) {
  const c = s.c;
  if (!c.optInInitial || c.optOutAt !== null || bounced.has(c.memberId)) continue;
  emailEvents.push({ key: c.memberId, name: s.name, type: "sent", url: null, at: s.at });
  if (c.badEmail) {
    bounced.add(c.memberId);
    emailEvents.push({ key: c.memberId, name: s.name, type: "bounce", url: null, at: s.at + 60_000 });
    continue;
  }
  if (r.chance(c.openRate)) {
    const openAt = s.at + r.int(5, 48 * 60) * 60_000;
    if (openAt > AS_OF) continue;
    emailEvents.push({ key: c.memberId, name: s.name, type: "open", url: null, at: openAt });
    if (r.chance(0.12)) {
      emailEvents.push({ key: c.memberId, name: s.name, type: "click", url: linkFor(c, s.name), at: openAt + r.int(1, 10) * 60_000 });
    }
    if (s.name.startsWith("NL_") && r.chance(0.006)) {
      const at = openAt + r.int(1, 5) * 60_000;
      emailEvents.push({ key: c.memberId, name: s.name, type: "unsubscribe", url: null, at });
      c.optOutAt = at;
    }
  }
}
emailEvents.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));

// ---------------------------------------------------------------- EC サイトの行動(直近 3 か月)

interface WebEvent {
  device: string;
  member: string | null;
  type: "page_view" | "product_view" | "add_to_cart" | "purchase" | "login";
  page: string;
  product: string | null;
  order: string | null;
  qty: number | null;
  at: number;
}

const webEvents: WebEvent[] = [];
const usedDevices = new Set<string>();
function newDevice(): string {
  for (;;) {
    const id = `dev-${r.int(0, 0xffffff).toString(16).padStart(6, "0")}${r.int(0, 0xffff).toString(16).padStart(4, "0")}`;
    if (!usedDevices.has(id)) {
      usedDevices.add(id);
      return id;
    }
  }
}
const deviceOf = new Map<string, string>();
const device = (c: EcCustomer) => {
  let id = deviceOf.get(c.memberId);
  if (!id) {
    id = newDevice();
    deviceOf.set(c.memberId, id);
  }
  return id;
};

function browse(dev: string, member: string | null, start: number, favorite: Category | null, cartRate: number) {
  let t = start;
  const step = () => (t += r.int(20, 180) * 1000);
  const page = r.chance(0.15) && jstParts(start).m >= 10 ? "gift" : r.pick(["home", "category"]);
  webEvents.push({ device: dev, member, type: "page_view", page, product: null, order: null, qty: null, at: step() });
  const viewed: Product[] = [];
  for (let i = r.int(1, 4); i > 0; i--) {
    const pool = favorite && r.chance(0.6) ? selfProducts.filter((x) => x.category === favorite) : PRODUCTS;
    const product = r.pick(pool);
    viewed.push(product);
    webEvents.push({ device: dev, member, type: "product_view", page: "product", product: product.id, order: null, qty: null, at: step() });
  }
  if (r.chance(cartRate)) {
    const product = r.pick(viewed);
    webEvents.push({ device: dev, member, type: "add_to_cart", page: "product", product: product.id, order: null, qty: 1, at: step() });
    webEvents.push({ device: dev, member, type: "page_view", page: "cart", product: null, order: null, qty: null, at: step() });
  }
}

// 注文までの流れ
for (const o of completedOrders.filter((x) => x.at >= WEB_FROM)) {
  const c = o.customer;
  const dev = device(c);
  const isFirst = ordersByCustomer.get(c.memberId)![0] === o;
  if (isFirst && c.registeredAt >= WEB_FROM) {
    // 会員登録の前は、ログインしていない端末として記録される(登録後に同じ端末 ID でつながる)
    browse(dev, null, randomTime(c.registeredAt - 10 * DAY, c.registeredAt - DAY), null, 0.3);
  }
  let t = o.at - r.int(5, 25) * 60_000;
  const step = () => (t += r.int(20, 120) * 1000);
  if (isFirst || r.chance(0.5)) {
    webEvents.push({ device: dev, member: c.memberId, type: "login", page: "home", product: null, order: null, qty: null, at: step() });
  }
  webEvents.push({ device: dev, member: c.memberId, type: "page_view", page: o.isGift ? "gift" : "home", product: null, order: null, qty: null, at: step() });
  for (const line of o.lines) {
    webEvents.push({ device: dev, member: c.memberId, type: "product_view", page: "product", product: line.product.id, order: null, qty: null, at: step() });
    webEvents.push({ device: dev, member: c.memberId, type: "add_to_cart", page: "product", product: line.product.id, order: null, qty: line.qty, at: step() });
  }
  webEvents.push({ device: dev, member: c.memberId, type: "page_view", page: "cart", product: null, order: null, qty: null, at: step() });
  webEvents.push({ device: dev, member: c.memberId, type: "purchase", page: "order_complete", product: null, order: o.orderId, qty: null, at: Math.max(step(), o.at) });
}

// 買わずに見ただけ・カートに入れたまま(会員)
const activeSince = AS_OF - 365 * DAY;
for (const c of ecCustomers) {
  const list = ordersByCustomer.get(c.memberId);
  if (!list || list[list.length - 1].at < activeSince || c.registeredAt >= WEB_FROM) continue;
  const sessions = r.weighted([
    [0, 4],
    [1, 3],
    [2, 2],
    [3, 1],
  ] as const);
  for (let i = 0; i < sessions; i++) {
    browse(device(c), r.chance(0.6) ? c.memberId : null, randomTime(WEB_FROM, AS_OF), c.favorite, 0.22);
  }
}
// 会員でない人
for (let i = 0; i < 450; i++) {
  const dev = newDevice();
  for (let j = r.int(1, 2); j > 0; j--) browse(dev, null, randomTime(WEB_FROM, AS_OF), null, 0.1);
}
webEvents.sort((a, b) => a.at - b.at || a.device.localeCompare(b.device));

// ---------------------------------------------------------------- 名寄せの期待値(検算用)

const ROLE_SET = new Set(ROLE_LOCAL_PARTS);
const normEmail = (email: string | null) => (email ? email.trim().toLowerCase() : "");
const isRoleEmail = (email: string) => ROLE_SET.has(email.split("@")[0]);
const normPhone = (phone: string | null) => {
  if (!phone) return "";
  const d = digits(phone);
  return d.startsWith("81") && d.length === 12 ? `0${d.slice(2)}` : d;
};
const normName = (name: string, variants: boolean) =>
  variants ? KANJI_VARIANTS.reduce((s, [from, to]) => s.split(from).join(to), name).replace(/\s/g, "") : name;

interface IdNode {
  source: "ec" | "pos" | "contact" | "lead";
  id: string;
  partyIds: string[];
  email: string | null;
  phones: string[];
  last: string;
  first: string;
}

const nodes: IdNode[] = [
  ...ecCustomers.map((c) => ({
    source: "ec" as const,
    id: c.memberId,
    partyIds: [c.memberId],
    email: c.email,
    phones: [c.person.phone],
    last: c.person.last.kanji,
    first: c.person.first.kanji,
  })),
  ...posMembers.map((m) => ({
    source: "pos" as const,
    id: m.cardNo,
    partyIds: m.linked ? [m.cardNo, m.linked] : [m.cardNo],
    email: m.email,
    phones: [m.phone],
    last: m.lastName,
    first: m.firstName,
  })),
  ...contacts.map((c) => ({
    source: "contact" as const,
    id: c.ref,
    partyIds: [],
    email: c.email,
    phones: [c.account.phone, ...(c.mobile ? [c.mobile] : [])],
    last: c.person.last.kanji,
    first: c.person.first.kanji,
  })),
  ...leads.map((l, i) => ({
    source: "lead" as const,
    id: `lead-${i + 1}`,
    partyIds: [],
    email: l.email,
    phones: [l.phone],
    last: l.person.last.kanji,
    first: l.person.first.kanji,
  })),
];

interface RuleOptions {
  variants: boolean;
  excludeRoleEmails: boolean;
  phoneOnly: boolean;
}

function resolve(opts: RuleOptions): number[] {
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map<string, number>();
  const link = (i: number, key: string) => {
    const o = owner.get(key);
    if (o === undefined) owner.set(key, i);
    else parent[find(o)] = find(i);
  };
  nodes.forEach((n, i) => {
    for (const id of n.partyIds) link(i, `party:${id}`);
    const email = normEmail(n.email);
    if (email && !(opts.excludeRoleEmails && isRoleEmail(email))) link(i, `email:${email}`);
    for (const phone of n.phones.map(normPhone).filter(Boolean)) {
      link(i, opts.phoneOnly ? `phone:${phone}` : `name:${normName(n.last, opts.variants)}${normName(n.first, opts.variants)}|${phone}`);
    }
  });
  return nodes.map((_, i) => find(i));
}

const RULES: RuleOptions = { variants: true, excludeRoleEmails: true, phoneOnly: false };
const components = resolve(RULES);
const countComponents = (c: number[]) => new Set(c).size;
const unifiedCount = countComponents(components);
const withoutVariants = countComponents(resolve({ ...RULES, variants: false }));
const withRoleEmails = countComponents(resolve({ ...RULES, excludeRoleEmails: false }));
const phoneOnly = countComponents(resolve({ ...RULES, phoneOnly: true }));

// 正解(生成時に分かっている「同じ人」)とのずれがないかを確かめる
{
  const truth = new Map<string, string>(); // ノード → 本当の人
  nodes.forEach((n) => truth.set(`${n.source}:${n.id}`, `${n.source}:${n.id}`));
  posMembers.forEach((m) => m.ec && truth.set(`pos:${m.cardNo}`, `ec:${m.ec.memberId}`));
  contacts.forEach((c) => c.ec && truth.set(`contact:${c.ref}`, `ec:${c.ec.memberId}`));
  leads.forEach((l, i) => l.ec && truth.set(`lead:lead-${i + 1}`, `ec:${l.ec.memberId}`));
  const byComponent = new Map<number, Set<string>>();
  nodes.forEach((n, i) => {
    const set = byComponent.get(components[i]) ?? new Set<string>();
    set.add(truth.get(`${n.source}:${n.id}`)!);
    byComponent.set(components[i], set);
  });
  const wrong = [...byComponent.values()].filter((s) => s.size > 1).length;
  const people = new Set(truth.values()).size;
  if (wrong > 0 || people !== unifiedCount) {
    throw new Error(`名寄せの期待値が正解と合わない(誤統合 ${wrong} 件、正解 ${people} 人、ルールの結果 ${unifiedCount} 人)`);
  }
}

// ---------------------------------------------------------------- セグメントの人数の期待値(検算用)

interface Profile {
  orders: { at: number; amount: number }[];
  optIn: boolean;
  oseibo2025: boolean;
  corporateSignal: boolean;
  inCrm: boolean;
}

const profiles = new Map<number, Profile>();
const profileOf = (i: number) => {
  let p = profiles.get(components[i]);
  if (!p) {
    p = { orders: [], optIn: false, oseibo2025: false, corporateSignal: false, inCrm: false };
    profiles.set(components[i], p);
  }
  return p;
};
const nodeIndex = new Map(nodes.map((n, i) => [`${n.source}:${n.id}`, i]));
const isCompanyEmail = (email: string) => !PERSONAL_DOMAINS.includes(email.split("@")[1]);

for (const c of ecCustomers) {
  const p = profileOf(nodeIndex.get(`ec:${c.memberId}`)!);
  if (c.optInInitial && c.optOutAt === null && !bounced.has(c.memberId)) p.optIn = true;
  if (isCompanyEmail(c.email)) p.corporateSignal = true;
}
for (const o of completedOrders) {
  const p = profileOf(nodeIndex.get(`ec:${o.customer.memberId}`)!);
  p.orders.push({ at: o.at, amount: o.total });
  if (o.isGift && o.occasion === "Oseibo" && o.at >= jst(2025, 11, 1) && o.at < jst(2026, 1, 1)) p.oseibo2025 = true;
  if (o.isGift && o.destinations >= 10) p.corporateSignal = true;
}
for (const m of posMembers) {
  const p = profileOf(nodeIndex.get(`pos:${m.cardNo}`)!);
  if (m.optIn && m.email) p.optIn = true;
}
for (const t of posTransactions) {
  profileOf(nodeIndex.get(`pos:${t.member.cardNo}`)!).orders.push({ at: t.at, amount: t.total });
}
nodes.forEach((n, i) => {
  if (n.source === "contact" || n.source === "lead") profileOf(i).inCrm = true;
});

const segmentCounts = { s1: 0, s2: 0, s3: 0, s4: 0, s5: 0, s6: 0, reachable: 0, buyers: 0, repeaters: 0 };
for (const p of profiles.values()) {
  if (p.optIn) segmentCounts.reachable++;
  if (p.orders.length === 0) continue;
  p.orders.sort((a, b) => a.at - b.at);
  segmentCounts.buyers++;
  if (p.orders.length >= 2) segmentCounts.repeaters++;
  const firstDays = daysBetween(p.orders[0].at, AS_OF);
  const lastDays = daysBetween(p.orders[p.orders.length - 1].at, AS_OF);
  const recent = p.orders.filter((o) => daysBetween(o.at, AS_OF) < 365);
  if (p.optIn && p.orders.length === 1 && firstDays <= 30) segmentCounts.s1++;
  if (p.optIn && p.orders.length === 1 && firstDays >= 31 && firstDays <= 90) segmentCounts.s2++;
  if (p.optIn && p.orders.length >= 2 && lastDays >= 120 && lastDays <= 240) segmentCounts.s3++;
  if (sum(recent.map((o) => o.amount)) >= 30000 || recent.length >= 6) segmentCounts.s4++;
  if (p.optIn && p.oseibo2025) segmentCounts.s5++;
  if (p.optIn && p.corporateSignal && !p.inCrm) segmentCounts.s6++;
}

// ---------------------------------------------------------------- 整合性の確認

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(`整合性の確認に失敗: ${message}`);
}
const unique = <T>(xs: T[]) => new Set(xs).size === xs.length;
check(unique(ecCustomers.map((c) => c.memberId)), "EC会員ID が重複");
check(unique(ecCustomers.map((c) => c.email)), "EC会員のメールアドレスが重複");
check(unique(orders.map((o) => o.orderId)), "注文番号が重複");
check(unique(posMembers.map((m) => m.cardNo)), "店舗会員番号が重複");
check(
  orders.every((o) => o.total === sum(o.lines.map((x) => x.qty * x.product.price)) + o.shipping - o.discount),
  "注文の合計が明細と合わない",
);
check(
  orders.every((o) => o.at >= o.customer.registeredAt && o.at <= AS_OF),
  "注文日時が会員登録より前、または基準日より後",
);
check(
  posTransactions.every((t) => t.at >= START && t.at <= AS_OF && t.lines.length > 0),
  "店舗購買の日時か明細がおかしい",
);
check(
  emailEvents.every((e) => e.at <= AS_OF),
  "メールの反応が基準日より後",
);
check(
  ecCustomers.every(
    (c) =>
      c.optOutAt === null ||
      !emailEvents.some((e) => e.key === c.memberId && e.type === "sent" && e.at > c.optOutAt!),
  ),
  "配信停止の後にメールを送っている",
);
check(
  ecCustomers.every((c) => c.optInInitial || !emailEvents.some((e) => e.key === c.memberId)),
  "同意のない人にメールを送っている",
);
const orderIds = new Set(orders.map((o) => o.orderId));
check(
  webEvents.every((e) => (e.type === "purchase" ? e.order !== null && orderIds.has(e.order) : e.order === null)),
  "購入イベントの注文番号がおかしい",
);
check(opportunities.length <= 200 && contacts.length <= 200 && leads.length <= 200, "sf data import tree の 1 ファイル 200 件を超える");

// ---------------------------------------------------------------- 書き出し

writeTable(
  TABLES.ecCustomers,
  ecCustomers.map((c) => ({
    member_id: c.memberId,
    last_name: c.person.last.kanji,
    first_name: c.person.first.kanji,
    last_name_kana: c.person.last.kana,
    first_name_kana: c.person.first.kana,
    email: c.email,
    phone: c.person.phone,
    prefecture: c.prefecture,
    birth_year: c.birthYear,
    registered_at: iso(c.registeredAt),
    email_opt_in: c.optInInitial && c.optOutAt === null,
    email_opt_in_at: c.optInInitial ? iso(c.registeredAt) : null,
    email_opt_out_at: c.optOutAt === null ? null : iso(c.optOutAt),
    updated_at: iso(Math.max(c.registeredAt, c.optOutAt ?? 0)),
  })),
);

writeTable(
  TABLES.products,
  PRODUCTS.map((x) => ({
    product_id: x.id,
    name: x.name,
    category: x.category,
    category_label: CATEGORY_LABEL[x.category],
    price: x.price,
    gift_eligible: x.giftEligible,
    noshi_available: x.noshi,
    gift_occasions: x.occasions.join(";"),
    caffeine_level: x.caffeine,
    shelf_life_days: x.shelfLifeDays,
    is_active: true,
    product_url: productUrl(x),
    image_url: imageUrl(x),
  })),
);

writeTable(
  TABLES.ecOrders,
  orders.map((o) => ({
    order_id: o.orderId,
    member_id: o.customer.memberId,
    ordered_at: iso(o.at),
    is_gift: o.isGift,
    gift_occasion: o.occasion,
    destinations_count: o.destinations,
    noshi: o.noshi,
    subtotal: o.subtotal,
    shipping_fee: o.shipping,
    discount: o.discount,
    total: o.total,
    coupon_code: o.coupon,
    status: o.cancelled ? "cancelled" : "completed",
  })),
);

writeTable(
  TABLES.ecOrderItems,
  orders.flatMap((o) =>
    o.lines.map((x, i) => ({
      order_item_id: `${o.orderId}-${i + 1}`,
      order_id: o.orderId,
      line_no: i + 1,
      product_id: x.product.id,
      quantity: x.qty,
      unit_price: x.product.price,
      amount: x.qty * x.product.price,
      ordered_at: iso(o.at),
    })),
  ),
);

writeTable(
  TABLES.posMembers,
  posMembers.map((m) => ({
    card_no: m.cardNo,
    last_name: m.lastName,
    first_name: m.firstName,
    last_name_kana: m.lastKana,
    first_name_kana: m.firstKana,
    email: m.email,
    phone: m.phone,
    linked_ec_member_id: m.linked,
    email_opt_in: m.optIn,
    home_store_id: m.homeStore,
    joined_at: iso(m.joinedAt),
    updated_at: iso(m.joinedAt),
  })),
);

writeTable(
  TABLES.posTransactions,
  posTransactions.map((t) => ({
    transaction_id: t.transactionId,
    card_no: t.member.cardNo,
    store_id: t.store,
    purchased_at: iso(t.at),
    total: t.total,
    items_count: t.lines.length,
  })),
);

writeTable(
  TABLES.posTransactionItems,
  posTransactions.flatMap((t) =>
    t.lines.map((x, i) => ({
      transaction_item_id: `${t.transactionId}-${i + 1}`,
      transaction_id: t.transactionId,
      line_no: i + 1,
      product_id: x.product.id,
      quantity: x.qty,
      unit_price: x.product.price,
      amount: x.qty * x.product.price,
      purchased_at: iso(t.at),
    })),
  ),
);

writeTable(
  TABLES.webEvents,
  webEvents.map((e, i) => ({
    event_id: `W-${pad(i + 1, 7)}`,
    device_id: e.device,
    member_id: e.member,
    event_type: e.type,
    page_type: e.page,
    product_id: e.product,
    order_id: e.order,
    quantity: e.qty,
    occurred_at: iso(e.at),
  })),
);

writeTable(
  TABLES.emailEvents,
  emailEvents.map((e, i) => ({
    event_id: `E-${pad(i + 1, 7)}`,
    subscriber_key: e.key,
    email_name: e.name,
    event_type: e.type,
    link_url: e.url,
    occurred_at: iso(e.at),
  })),
);

write(path.join("data360", "ingestion-api-schema.yaml"), ingestionSchemaYaml(Object.values(TABLES)));

// Sales Cloud(sf data import tree)
const tree = (records: object[]) => `${JSON.stringify({ records }, null, 2)}\n`;
write(
  path.join("data", "crm", "Account.json"),
  tree(
    accounts.map((a) => ({
      attributes: { type: "Account", referenceId: a.ref },
      Name: a.company.name,
      Phone: a.phone,
      BillingState: a.prefecture,
      NumberOfEmployees: a.employees,
      Website: `https://www.${a.company.slug}.example`,
    })),
  ),
);
write(
  path.join("data", "crm", "Contact.json"),
  tree(
    contacts.map((c) => ({
      attributes: { type: "Contact", referenceId: c.ref },
      AccountId: `@${c.account.ref}`,
      LastName: c.person.last.kanji,
      FirstName: c.person.first.kanji,
      Email: c.email,
      Phone: c.account.phone,
      ...(c.mobile ? { MobilePhone: c.mobile } : {}),
      ...(c.department ? { Department: c.department } : {}),
      ...(c.title ? { Title: c.title } : {}),
    })),
  ),
);
write(
  path.join("data", "crm", "Opportunity.json"),
  tree(
    opportunities.map((o) => ({
      attributes: { type: "Opportunity", referenceId: o.ref },
      AccountId: `@${o.account.ref}`,
      Name: o.name,
      StageName: o.stage,
      CloseDate: o.closeDate,
      Amount: o.amount,
      GiftOccasion__c: o.occasion,
      GiftQuantity__c: o.quantity,
      DeliveryDate__c: o.deliveryDate,
      IsRepeat__c: o.isRepeat,
    })),
  ),
);
write(
  path.join("data", "crm", "Lead.json"),
  tree(
    leads.map((l, i) => ({
      attributes: { type: "Lead", referenceId: `LeadRef${i + 1}` },
      Company: l.company.name,
      LastName: l.person.last.kanji,
      FirstName: l.person.first.kanji,
      Email: l.email,
      Phone: l.phone,
      GiftQuantity__c: l.quantity,
      GiftBudgetPerItem__c: l.budget,
      GiftOccasion__c: l.occasion,
      DesiredDeliveryDate__c: l.desiredDate,
      InquiryChannel__c: l.channel,
      InquiryDate__c: jstDate(l.inquiryAt),
      InquirySummary__c: l.summary,
    })),
  ),
);
write(
  path.join("data", "crm", "plan.json"),
  `${JSON.stringify(
    [
      { sobject: "Account", saveRefs: true, resolveRefs: false, files: ["Account.json"] },
      { sobject: "Contact", saveRefs: false, resolveRefs: true, files: ["Contact.json"] },
      { sobject: "Opportunity", saveRefs: false, resolveRefs: true, files: ["Opportunity.json"] },
      { sobject: "Lead", saveRefs: false, resolveRefs: false, files: ["Lead.json"] },
    ],
    null,
    2,
  )}\n`,
);

// 商品と標準価格(匿名 Apex)
const apexString = (x: string) => `'${x.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const productLines = PRODUCTS.map((x) => {
  const fields = [
    `Name = ${apexString(x.name)}`,
    `ProductCode = ${apexString(x.id)}`,
    "IsActive = true",
    `TeaCategory__c = ${apexString(x.category)}`,
    `GiftEligible__c = ${x.giftEligible}`,
    `NoshiAvailable__c = ${x.noshi}`,
    `GiftOccasions__c = ${x.occasions.length ? apexString(x.occasions.join(";")) : "null"}`,
    `CaffeineLevel__c = ${x.caffeine ? apexString(x.caffeine) : "null"}`,
    `ShelfLifeDays__c = ${x.shelfLifeDays ?? "null"}`,
  ];
  return `    ${apexString(x.id)} => new Product2(${fields.join(", ")})`;
});
const priceLines = PRODUCTS.map((x) => `    ${apexString(x.id)} => ${x.price}`);
write(
  path.join("scripts", "apex", "seed-products.apex"),
  [
    "// しずく茶舗(架空)の商品と、標準価格表の価格(税込)を登録する。",
    "// scripts/generate-data.ts が生成する(手で書き換えない)。商品コードで照合するので、何度実行しても同じ状態になる。",
    "// 実行: sf apex run --file scripts/apex/seed-products.apex --target-org shizuku",
    "Map<String, Product2> products = new Map<String, Product2>{",
    productLines.join(",\n"),
    "};",
    "Map<String, Decimal> prices = new Map<String, Decimal>{",
    priceLines.join(",\n"),
    "};",
    "for (Product2 existing : [SELECT Id, ProductCode FROM Product2 WHERE ProductCode IN :products.keySet()]) {",
    "    products.get(existing.ProductCode).Id = existing.Id;",
    "}",
    "upsert products.values();",
    "",
    "Id standardId = [SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1].Id;",
    "Map<Id, Id> entryByProduct = new Map<Id, Id>();",
    "for (PricebookEntry e : [SELECT Id, Product2Id FROM PricebookEntry WHERE Pricebook2Id = :standardId AND Product2.ProductCode IN :products.keySet()]) {",
    "    entryByProduct.put(e.Product2Id, e.Id);",
    "}",
    "List<PricebookEntry> toInsert = new List<PricebookEntry>();",
    "List<PricebookEntry> toUpdate = new List<PricebookEntry>();",
    "for (Product2 p : products.values()) {",
    "    Decimal price = prices.get(p.ProductCode);",
    "    if (entryByProduct.containsKey(p.Id)) {",
    "        toUpdate.add(new PricebookEntry(Id = entryByProduct.get(p.Id), UnitPrice = price, IsActive = true));",
    "    } else {",
    "        toInsert.add(new PricebookEntry(Pricebook2Id = standardId, Product2Id = p.Id, UnitPrice = price, IsActive = true));",
    "    }",
    "}",
    "insert toInsert;",
    "update toUpdate;",
    "System.debug('商品 ' + products.size() + ' 件と標準価格を登録しました');",
    "",
  ].join("\n"),
);

// ---------------------------------------------------------------- data/README.md

const buyersEc = new Set(completedOrders.map((o) => o.customer.memberId)).size;
const repeatersEc = [...ordersByCustomer.values()].filter((x) => x.length >= 2).length;
const f2Within90 = [...ordersByCustomer.values()].filter(
  (x) => daysBetween(x[0].at, AS_OF) >= 90,
);
const f2Rate = f2Within90.filter((x) => x.length >= 2 && daysBetween(x[0].at, x[1].at) <= 90).length / f2Within90.length;
const giftShare = completedOrders.filter((o) => o.isGift).length / completedOrders.length;
const posKinds = (k: PosKind) => posMembers.filter((m) => m.kind === k).length;
const wonOpps = opportunities.filter((o) => o.stage === "Closed Won");
const closedOpps = opportunities.filter((o) => o.stage.startsWith("Closed"));
const repeatClosed = closedOpps.filter((o) => o.isRepeat);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const count = (n: number) => n.toLocaleString("en-US");
const fileRows = (table: TableDef) => outputs.get(path.join("data", table.file))!.trimEnd().split("\n").length - 1;

const readme = `# 架空データ

\`scripts/generate-data.ts\` が生成した、しずく茶舗(架空)のデータです。手で書き換えず、変えるときはスクリプトを直して \`npm run generate-data\` を実行します。
乱数の種(${SEED})と基準日(2026年10月31日)を固定しているので、何度実行しても同じ内容になります。
人物・会社・メールアドレス・電話番号はすべて架空です(メールは予約済みのドメイン \`example.com\` などと \`.example\` だけを使用)。

日時は UTC(末尾 Z)で書いています。日本時間に直すと 9 時間後です。

## ファイルと件数

| ファイル | 内容 | 件数 | 入れる先 |
|---|---|---:|---|
${Object.values(TABLES)
  .map((t) => `| \`${t.file}\` | ${t.label} | ${count(fileRows(t))} | Data 360(Ingestion API・${t.category}) |`)
  .join("\n")}
| \`crm/Account.json\` | 法人の取引先 | ${accounts.length} | Sales Cloud(\`sf data import tree\`) |
| \`crm/Contact.json\` | 取引先責任者 | ${contacts.length} | Sales Cloud |
| \`crm/Opportunity.json\` | 法人ギフトの商談 | ${opportunities.length} | Sales Cloud |
| \`crm/Lead.json\` | 法人ギフトの相談(リード) | ${leads.length} | Sales Cloud |

Data 360 の Ingestion API に登録するスキーマは \`../data360/ingestion-api-schema.yaml\`、商品と価格を Sales Cloud に入れる匿名 Apex は \`../scripts/apex/seed-products.apex\` です。

## 架空データの特徴

- EC会員 ${count(ecCustomers.length)} 人のうち、購入したことがある人は ${count(buyersEc)} 人、2 回以上購入した人は ${count(repeatersEc)} 人
- 初回購入から 90 日以内に 2 回目を買った人の割合(初回が 90 日以上前の人のうち):**${pct(f2Rate)}**(KPI「2回目購入率」の現状値として使う)
- ギフト注文の割合:${pct(giftShare)}(お中元 6/15〜7/15、お歳暮 11/20〜12/20 に集中)
- 取引先責任者 ${contacts.length} 人のうち、EC会員と同じ人は ${contacts.filter((c) => c.ec).length} 人(会社のアドレスで EC を使っている人 ${contacts.filter((c) => c.ec && c.email === c.ec.email).length} 人、個人のアドレスで使っている人 ${contacts.filter((c) => c.ec && c.email !== c.ec.email).length} 人)
- 法人ギフトの商談 ${opportunities.length} 件のうち、完了 ${closedOpps.length} 件の受注率 ${pct(wonOpps.filter((o) => closedOpps.includes(o)).length / closedOpps.length)}、リピート商談の受注率 ${pct(repeatClosed.filter((o) => o.stage === "Closed Won").length / Math.max(1, repeatClosed.length))}

## 名寄せの期待値(検算用)

Data 360 の ID 解決ルールセットを \`../docs/02-data360.md\` のとおりに設定すると、統合プロファイルの数は次のようになるはずです。
組織で ID 解決を実行したら、この数と比べて設定を確かめます。

| 元の件数 | 件数 |
|---|---:|
| EC会員 | ${count(ecCustomers.length)} |
| 店舗会員 | ${count(posMembers.length)} |
| 取引先責任者 | ${count(contacts.length)} |
| リード | ${count(leads.length)} |
| **合計** | **${count(nodes.length)}** |
| **統合後の人数(期待値)** | **${count(unifiedCount)}** |

店舗会員 ${posMembers.length} 人の内訳(生成時に決めた正解):

| 種類 | 人数 | 統合されるか(どのルールで) |
|---|---:|---|
| メールアドレスが同じ(大文字・前後の空白の揺れあり) | ${posKinds("same_email")} | される(メールアドレス) |
| メールなし・氏名と電話番号が同じ(異体字・電話番号の書き方の揺れあり) | ${posKinds("name_phone")} | される(氏名+電話番号) |
| アプリで EC会員と連携済み | ${posKinds("linked")} | される(EC会員ID) |
| 古いメールアドレス・氏名と電話番号が同じ | ${posKinds("old_email")} | される(氏名+電話番号) |
| 店舗だけの会員 | ${posKinds("store_only")} | されない |
| EC会員の家族(同じ姓・同じ電話番号・名が違う) | ${posKinds("family")} | **されない**(電話番号だけでは統合しない) |

ルールを変えたときの人数(誤ったルールで何が起きるか):

| ルール | 統合後の人数 | 期待値との差 | 起きること |
|---|---:|---:|---|
| 期待値のルール | ${count(unifiedCount)} | 0 | — |
| 異体字を正規化しない | ${count(withoutVariants)} | ${withoutVariants - unifiedCount > 0 ? "+" : ""}${withoutVariants - unifiedCount} | 同じ人が別人のまま残る(髙橋/高橋、山﨑/山崎 など) |
| 共有アドレス(soumu@ など)もメールで統合する | ${count(withRoleEmails)} | ${withRoleEmails - unifiedCount} | 総務部の別の担当者どうしが 1 人になる |
| 氏名を見ずに電話番号だけで統合する | ${count(phoneOnly)} | ${phoneOnly - unifiedCount} | 同じ電話番号の家族や、同じ会社の代表電話を登録した別々の担当者が 1 人になる |

## セグメントの人数の期待値(検算用)

基準日(2026年10月31日)時点。条件は \`../docs/02-data360.md\` の「セグメント」の表と同じです。
「メール可」は、配信に同意していて、配信停止・不達になっていないメールアドレスが統合プロファイルに 1 つ以上あることです(検算用に簡単にした判定)。

| セグメント | 人数 |
|---|---:|
| S1 初回購入フォロー(購入 1 回・初回購入から 30 日以内・メール可) | ${segmentCounts.s1} |
| S2 2回目購入の後押し(購入 1 回・初回購入から 31〜90 日・メール可) | ${segmentCounts.s2} |
| S3 休眠予備軍(購入 2 回以上・最終購入から 120〜240 日・メール可) | ${segmentCounts.s3} |
| S4 VIP(直近 365 日の購入額 30,000 円以上、または 6 回以上) | ${segmentCounts.s4} |
| S5 お歳暮の早期案内(2025年11〜12月にお歳暮のギフト注文あり・メール可) | ${segmentCounts.s5} |
| S6 法人ギフトの見込み(会社のアドレス、または送り先 10 件以上のギフト注文あり・Sales Cloud に未登録・メール可) | ${segmentCounts.s6} |
| (参考)メール可の人数 | ${count(segmentCounts.reachable)} |
| (参考)購入したことがある人数(EC・店舗の合計、統合後) | ${count(segmentCounts.buyers)} |
`;
write(path.join("data", "README.md"), readme);

// ---------------------------------------------------------------- 実行

const checkOnly = process.argv.includes("--check");
const stale: string[] = [];
for (const [rel, content] of outputs) {
  const file = path.join(ROOT, rel);
  if (checkOnly) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (current !== content) stale.push(rel);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    console.log(`  ${rel}`);
  }
}
if (checkOnly) {
  if (stale.length > 0) {
    console.error(`生成結果とコミット済みのファイルが違います。npm run generate-data を実行してください:\n  ${stale.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`生成結果とコミット済みのファイルは一致しています(${outputs.size} ファイル)`);
} else {
  console.log(`統合後の人数(期待値): ${unifiedCount} / セグメント: ${JSON.stringify(segmentCounts)}`);
}
