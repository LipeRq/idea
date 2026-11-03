// しずく茶舗(架空)の商品マスタ。価格は税込の定価(円)。
// Salesforce の項目の値(API 名)と同じ英字の区分を使う(force-app の選択リストと一致させる)。

export type Category = "Sencha" | "Gyokuro" | "Matcha" | "Hojicha" | "Wakoucha" | "Teaware" | "GiftSet";
export type Occasion = "Ochugen" | "Oseibo" | "Uchiiwai" | "Anniversary" | "Novelty";
export type Caffeine = "Low" | "Medium" | "High";

export const CATEGORY_LABEL: Record<Category, string> = {
  Sencha: "煎茶",
  Gyokuro: "玉露",
  Matcha: "抹茶",
  Hojicha: "ほうじ茶",
  Wakoucha: "和紅茶",
  Teaware: "茶器",
  GiftSet: "ギフトセット",
};

export const OCCASION_LABEL: Record<Occasion, string> = {
  Ochugen: "お中元",
  Oseibo: "お歳暮",
  Uchiiwai: "内祝い",
  Anniversary: "周年記念",
  Novelty: "ノベルティ",
};

export interface Product {
  id: string;
  slug: string;
  name: string;
  category: Category;
  price: number;
  giftEligible: boolean;
  noshi: boolean;
  occasions: Occasion[];
  /** 茶器は null */
  caffeine: Caffeine | null;
  /** 賞味期限の目安(日)。茶器は null */
  shelfLifeDays: number | null;
}

const ALL: Occasion[] = ["Ochugen", "Oseibo", "Uchiiwai", "Anniversary", "Novelty"];

function p(
  id: string,
  slug: string,
  name: string,
  category: Category,
  price: number,
  caffeine: Caffeine | null,
  shelfLifeDays: number | null,
  gift: { occasions: Occasion[]; noshi: boolean } | null = null,
): Product {
  return {
    id,
    slug,
    name,
    category,
    price,
    caffeine,
    shelfLifeDays,
    giftEligible: gift !== null,
    noshi: gift?.noshi ?? false,
    occasions: gift?.occasions ?? [],
  };
}

export const PRODUCTS: Product[] = [
  p("SZK-SEN-001", "sencha-shizuku", "煎茶「しずく」100g", "Sencha", 1620, "Medium", 180),
  p("SZK-SEN-002", "fukamushi-asatsuyu", "深蒸し煎茶「朝露」100g", "Sencha", 1944, "Medium", 180),
  p("SZK-SEN-003", "jo-sencha-wakaba", "上煎茶「若葉」80g 箱入り", "Sencha", 2700, "Medium", 180, {
    occasions: ["Uchiiwai", "Anniversary"],
    noshi: true,
  }),
  p("SZK-SEN-004", "sencha-teabag", "煎茶ティーバッグ 3g×20", "Sencha", 1080, "Medium", 365),
  p("SZK-DEC-001", "decaf-sencha", "カフェインレス煎茶 80g", "Sencha", 1728, "Low", 180),
  p("SZK-GYO-001", "gyokuro-midori", "玉露「翠」50g", "Gyokuro", 3240, "High", 180, {
    occasions: ["Ochugen", "Oseibo", "Uchiiwai", "Anniversary"],
    noshi: true,
  }),
  p("SZK-GYO-002", "gyokuro-kasumi", "玉露「霞」100g", "Gyokuro", 5400, "High", 180, {
    occasions: ["Ochugen", "Oseibo", "Anniversary"],
    noshi: true,
  }),
  p("SZK-MAT-001", "matcha-shirasagi", "抹茶「白鷺」30g缶", "Matcha", 2160, "High", 120),
  p("SZK-MAT-002", "matcha-chiyo", "抹茶「千代」40g缶", "Matcha", 4320, "High", 120, {
    occasions: ["Oseibo", "Anniversary"],
    noshi: true,
  }),
  p("SZK-MAT-003", "greentea-latte", "抹茶ラテの素 200g", "Matcha", 1296, "Medium", 270),
  p("SZK-HOJ-001", "hojicha-koro", "ほうじ茶「香炉」100g", "Hojicha", 1296, "Medium", 180),
  p("SZK-HOJ-002", "bo-hojicha", "棒ほうじ茶 100g", "Hojicha", 1512, "Medium", 180),
  p("SZK-HOJ-003", "decaf-hojicha-teabag", "カフェインレスほうじ茶 ティーバッグ 2g×20", "Hojicha", 1404, "Low", 365),
  p("SZK-WAK-001", "wakoucha-yunagi", "和紅茶「夕凪」50g", "Wakoucha", 1620, "Medium", 365),
  p("SZK-WAK-002", "wakoucha-teabag", "和紅茶ティーバッグ 2.5g×15", "Wakoucha", 1188, "Medium", 365),
  p("SZK-TEA-001", "kyusu-shudei", "急須(朱泥・300ml)", "Teaware", 4950, null, null, {
    occasions: ["Uchiiwai", "Anniversary"],
    noshi: true,
  }),
  p("SZK-TEA-002", "yunomi-pair", "湯呑み 2客セット", "Teaware", 3850, null, null, {
    occasions: ["Uchiiwai", "Anniversary"],
    noshi: true,
  }),
  p("SZK-TEA-003", "chazutsu", "茶筒", "Teaware", 2750, null, null),
  p("SZK-TEA-004", "chawan-chasen", "抹茶碗と茶筅のセット", "Teaware", 6600, null, null, {
    occasions: ["Uchiiwai", "Anniversary"],
    noshi: true,
  }),
  p("SZK-GFT-001", "gift-sencha-duo", "煎茶2種ギフト", "GiftSet", 2700, "Medium", 180, { occasions: ALL, noshi: true }),
  p("SZK-GFT-002", "gift-teabag-duo", "煎茶・ほうじ茶ティーバッグギフト", "GiftSet", 1620, "Medium", 365, {
    occasions: ["Uchiiwai", "Anniversary", "Novelty"],
    noshi: true,
  }),
  p("SZK-GFT-003", "gift-gyokuro-sencha", "玉露と煎茶の詰め合わせ", "GiftSet", 5400, "High", 180, {
    occasions: ["Ochugen", "Oseibo", "Anniversary"],
    noshi: true,
  }),
  p("SZK-GFT-004", "gift-matcha-chasen", "抹茶と茶筅のギフト", "GiftSet", 6480, "High", 120, {
    occasions: ["Oseibo", "Uchiiwai", "Anniversary"],
    noshi: true,
  }),
  p("SZK-GFT-005", "gift-seasonal-three", "季節の三種詰め合わせ", "GiftSet", 3780, "Medium", 180, {
    occasions: ["Ochugen", "Oseibo"],
    noshi: true,
  }),
  p("SZK-GFT-006", "petit-gift", "プチギフト(ティーバッグ3包)", "GiftSet", 540, "Medium", 365, {
    occasions: ["Uchiiwai", "Novelty"],
    noshi: false,
  }),
  p("SZK-GFT-007", "gift-decaf", "カフェインレス詰め合わせ", "GiftSet", 3240, "Low", 180, {
    occasions: ["Ochugen", "Oseibo", "Uchiiwai", "Anniversary"],
    noshi: true,
  }),
  p("SZK-GFT-008", "gift-name-can", "名入れ茶缶ギフト", "GiftSet", 2160, "Medium", 180, {
    occasions: ["Anniversary", "Novelty"],
    noshi: false,
  }),
  p("SZK-GFT-009", "gift-cold-brew", "水出し煎茶ギフト", "GiftSet", 2484, "Medium", 180, {
    occasions: ["Ochugen"],
    noshi: true,
  }),
  p("SZK-GFT-010", "gift-premium", "極上詰め合わせ", "GiftSet", 10800, "High", 180, {
    occasions: ["Ochugen", "Oseibo", "Anniversary"],
    noshi: true,
  }),
];

export const PRODUCT_BY_ID = new Map(PRODUCTS.map((x) => [x.id, x]));

export const SHOP_URL = "https://shop.example.com";
export const productUrl = (x: Product) => `${SHOP_URL}/products/${x.slug}`;
export const imageUrl = (x: Product) => `${SHOP_URL}/images/products/${x.slug}.jpg`;

/** 送料無料になる金額(送り先1件あたり、税込) */
export const FREE_SHIPPING_THRESHOLD = 5400;
export const SHIPPING_FEE = 660;
