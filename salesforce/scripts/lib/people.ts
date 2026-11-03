// 架空の人名・地域・会社名。組み合わせて作る人物・会社はすべて架空。
// メールアドレスは予約済みのドメイン(example.com など、.example)だけを使う。
// 電話番号は 2 つ目の区切りを 0 から始め、実在しない形にしている。

export interface NamePart {
  kanji: string;
  kana: string;
  romaji: string;
}

export interface Surname extends NamePart {
  /** 異体字(店舗の紙の申込書などで、こちらの字で登録される場合がある) */
  variant?: string;
}

export const SURNAMES: Surname[] = [
  { kanji: "佐藤", kana: "サトウ", romaji: "sato" },
  { kanji: "鈴木", kana: "スズキ", romaji: "suzuki" },
  { kanji: "高橋", kana: "タカハシ", romaji: "takahashi", variant: "髙橋" },
  { kanji: "田中", kana: "タナカ", romaji: "tanaka" },
  { kanji: "伊藤", kana: "イトウ", romaji: "ito" },
  { kanji: "渡辺", kana: "ワタナベ", romaji: "watanabe", variant: "渡邉" },
  { kanji: "山本", kana: "ヤマモト", romaji: "yamamoto" },
  { kanji: "中村", kana: "ナカムラ", romaji: "nakamura" },
  { kanji: "小林", kana: "コバヤシ", romaji: "kobayashi" },
  { kanji: "加藤", kana: "カトウ", romaji: "kato" },
  { kanji: "吉田", kana: "ヨシダ", romaji: "yoshida", variant: "𠮷田" },
  { kanji: "山田", kana: "ヤマダ", romaji: "yamada" },
  { kanji: "佐々木", kana: "ササキ", romaji: "sasaki" },
  { kanji: "山口", kana: "ヤマグチ", romaji: "yamaguchi" },
  { kanji: "松本", kana: "マツモト", romaji: "matsumoto" },
  { kanji: "井上", kana: "イノウエ", romaji: "inoue" },
  { kanji: "木村", kana: "キムラ", romaji: "kimura" },
  { kanji: "林", kana: "ハヤシ", romaji: "hayashi" },
  { kanji: "斎藤", kana: "サイトウ", romaji: "saito", variant: "齋藤" },
  { kanji: "清水", kana: "シミズ", romaji: "shimizu" },
  { kanji: "山崎", kana: "ヤマザキ", romaji: "yamazaki", variant: "山﨑" },
  { kanji: "森", kana: "モリ", romaji: "mori" },
  { kanji: "池田", kana: "イケダ", romaji: "ikeda" },
  { kanji: "橋本", kana: "ハシモト", romaji: "hashimoto" },
  { kanji: "阿部", kana: "アベ", romaji: "abe" },
  { kanji: "石川", kana: "イシカワ", romaji: "ishikawa" },
  { kanji: "前田", kana: "マエダ", romaji: "maeda" },
  { kanji: "藤田", kana: "フジタ", romaji: "fujita" },
  { kanji: "小川", kana: "オガワ", romaji: "ogawa" },
  { kanji: "岡田", kana: "オカダ", romaji: "okada" },
  { kanji: "長谷川", kana: "ハセガワ", romaji: "hasegawa" },
  { kanji: "村上", kana: "ムラカミ", romaji: "murakami" },
  { kanji: "近藤", kana: "コンドウ", romaji: "kondo" },
  { kanji: "坂本", kana: "サカモト", romaji: "sakamoto" },
  { kanji: "青木", kana: "アオキ", romaji: "aoki" },
  { kanji: "西村", kana: "ニシムラ", romaji: "nishimura" },
  { kanji: "福田", kana: "フクダ", romaji: "fukuda" },
  { kanji: "太田", kana: "オオタ", romaji: "ota" },
  { kanji: "三浦", kana: "ミウラ", romaji: "miura" },
  { kanji: "藤井", kana: "フジイ", romaji: "fujii" },
];

/** 異体字 → 通常の字(名寄せの前の正規化に使う。Data 360 では数式項目で同じ置き換えをする) */
export const KANJI_VARIANTS: [string, string][] = [
  ["髙", "高"],
  ["邉", "辺"],
  ["邊", "辺"],
  ["𠮷", "吉"],
  ["齋", "斎"],
  ["﨑", "崎"],
];

const FEMALE: NamePart[] = [
  { kanji: "陽子", kana: "ヨウコ", romaji: "yoko" },
  { kanji: "恵子", kana: "ケイコ", romaji: "keiko" },
  { kanji: "直美", kana: "ナオミ", romaji: "naomi" },
  { kanji: "由美子", kana: "ユミコ", romaji: "yumiko" },
  { kanji: "真由美", kana: "マユミ", romaji: "mayumi" },
  { kanji: "美穂", kana: "ミホ", romaji: "miho" },
  { kanji: "智子", kana: "トモコ", romaji: "tomoko" },
  { kanji: "久美子", kana: "クミコ", romaji: "kumiko" },
  { kanji: "裕子", kana: "ユウコ", romaji: "yuko" },
  { kanji: "麻衣", kana: "マイ", romaji: "mai" },
  { kanji: "彩", kana: "アヤ", romaji: "aya" },
  { kanji: "千尋", kana: "チヒロ", romaji: "chihiro" },
  { kanji: "香織", kana: "カオリ", romaji: "kaori" },
  { kanji: "沙織", kana: "サオリ", romaji: "saori" },
  { kanji: "明美", kana: "アケミ", romaji: "akemi" },
  { kanji: "典子", kana: "ノリコ", romaji: "noriko" },
  { kanji: "佳奈", kana: "カナ", romaji: "kana" },
  { kanji: "結衣", kana: "ユイ", romaji: "yui" },
  { kanji: "奈々", kana: "ナナ", romaji: "nana" },
  { kanji: "美咲", kana: "ミサキ", romaji: "misaki" },
];

const MALE: NamePart[] = [
  { kanji: "誠", kana: "マコト", romaji: "makoto" },
  { kanji: "健一", kana: "ケンイチ", romaji: "kenichi" },
  { kanji: "浩", kana: "ヒロシ", romaji: "hiroshi" },
  { kanji: "大輔", kana: "ダイスケ", romaji: "daisuke" },
  { kanji: "拓也", kana: "タクヤ", romaji: "takuya" },
  { kanji: "翔太", kana: "ショウタ", romaji: "shota" },
  { kanji: "隆", kana: "タカシ", romaji: "takashi" },
  { kanji: "修", kana: "オサム", romaji: "osamu" },
  { kanji: "和也", kana: "カズヤ", romaji: "kazuya" },
  { kanji: "健太", kana: "ケンタ", romaji: "kenta" },
  { kanji: "直樹", kana: "ナオキ", romaji: "naoki" },
  { kanji: "亮", kana: "リョウ", romaji: "ryo" },
  { kanji: "学", kana: "マナブ", romaji: "manabu" },
  { kanji: "悠真", kana: "ユウマ", romaji: "yuma" },
  { kanji: "正樹", kana: "マサキ", romaji: "masaki" },
];

/** 茶葉 D2C の購入者を想定し、女性の名前を多めにする */
export const GIVEN_NAMES: (readonly [NamePart, number])[] = [
  ...FEMALE.map((n) => [n, 1.6] as const),
  ...MALE.map((n) => [n, 1] as const),
];

export const PREFECTURES: (readonly [string, number])[] = [
  ["東京都", 15],
  ["神奈川県", 9],
  ["大阪府", 8],
  ["愛知県", 7],
  ["埼玉県", 7],
  ["千葉県", 6],
  ["兵庫県", 5],
  ["福岡県", 5],
  ["静岡県", 4],
  ["北海道", 4],
  ["京都府", 3],
  ["宮城県", 2],
  ["広島県", 2],
  ["茨城県", 2],
  ["新潟県", 2],
  ["長野県", 2],
  ["岐阜県", 1],
  ["奈良県", 1],
  ["岡山県", 1],
  ["熊本県", 1],
];

/** 個人のメールアドレス(フリーメール相当)に使うドメイン */
export const PERSONAL_DOMAINS = ["example.com", "example.net", "example.org", "mail.example.com"];

/** 共有のアドレス(info@ など)。名寄せのキーにしない */
export const ROLE_LOCAL_PARTS = ["info", "soumu", "somu", "admin", "contact", "sales", "support", "gift"];

export interface Company {
  name: string;
  short: string;
  slug: string;
}

function c(name: string, short: string, slug: string): Company {
  return { name: `${name}(架空)`, short, slug };
}

/** Sales Cloud の取引先(法人ギフトの取引がある会社) */
export const ACCOUNT_COMPANIES: Company[] = [
  c("株式会社あさひ精機", "あさひ精機", "asahi-seiki"),
  c("みなと商事株式会社", "みなと商事", "minato-shoji"),
  c("株式会社ひかり不動産", "ひかり不動産", "hikari-fudosan"),
  c("つばさ物流株式会社", "つばさ物流", "tsubasa-butsuryu"),
  c("税理士法人かえで", "税理士法人かえで", "kaede-tax"),
  c("医療法人社団いずみ会", "いずみ会", "izumikai"),
  c("株式会社さくら建設", "さくら建設", "sakura-kensetsu"),
  c("なぎさ食品株式会社", "なぎさ食品", "nagisa-foods"),
  c("こだま電子株式会社", "こだま電子", "kodama-denshi"),
  c("株式会社はるか保険サービス", "はるか保険サービス", "haruka-hoken"),
  c("株式会社わかばシステム", "わかばシステム", "wakaba-system"),
  c("株式会社ほしぞら印刷", "ほしぞら印刷", "hoshizora-print"),
  c("しらなみ工業株式会社", "しらなみ工業", "shiranami-kogyo"),
  c("株式会社あおぞら設計", "あおぞら設計", "aozora-sekkei"),
  c("株式会社もみじ観光", "もみじ観光", "momiji-kanko"),
  c("やまびこ電機株式会社", "やまびこ電機", "yamabiko-denki"),
  c("株式会社すずらん薬局", "すずらん薬局", "suzuran-pharmacy"),
  c("弁護士法人こはる", "弁護士法人こはる", "koharu-law"),
  c("株式会社いろは広告", "いろは広告", "iroha-ad"),
  c("株式会社ふたば住宅", "ふたば住宅", "futaba-jutaku"),
  c("かがやき証券株式会社", "かがやき証券", "kagayaki-sec"),
  c("株式会社たちばな自動車", "たちばな自動車", "tachibana-auto"),
  c("株式会社ひだまり介護", "ひだまり介護", "hidamari-kaigo"),
  c("株式会社みずき製作所", "みずき製作所", "mizuki-ss"),
  c("株式会社つむぎ商店", "つむぎ商店", "tsumugi-shoten"),
  c("医療法人あかね歯科", "あかね歯科", "akane-dental"),
  c("いなほ運輸株式会社", "いなほ運輸", "inaho-unyu"),
  c("株式会社そよかぜ旅行", "そよかぜ旅行", "soyokaze-travel"),
  c("株式会社ことぶき会館", "ことぶき会館", "kotobuki-kaikan"),
  c("株式会社みのり農園", "みのり農園", "minori-farm"),
  c("株式会社しおさい水産", "しおさい水産", "shiosai-suisan"),
  c("株式会社あけぼの塗装", "あけぼの塗装", "akebono-tosou"),
  c("株式会社ゆうひ電設", "ゆうひ電設", "yuhi-densetsu"),
  c("株式会社くすのき学院", "くすのき学院", "kusunoki-gakuin"),
  c("社会福祉法人ひまわり会", "ひまわり会", "himawarikai"),
  c("株式会社こもれびデザイン", "こもれびデザイン", "komorebi-design"),
  c("株式会社ささなみ工務店", "ささなみ工務店", "sasanami-koumuten"),
  c("株式会社あやめ化粧品", "あやめ化粧品", "ayame-cosme"),
  c("株式会社はやぶさ通信", "はやぶさ通信", "hayabusa-tsushin"),
  c("株式会社ときわ百貨", "ときわ百貨", "tokiwa-hyakka"),
];

/** Sales Cloud のリード(相談をもらったが、まだ取引のない会社) */
export const LEAD_COMPANIES: Company[] = [
  c("株式会社のぞみ技研", "のぞみ技研", "nozomi-giken"),
  c("株式会社あすなろ商会", "あすなろ商会", "asunaro-shokai"),
  c("株式会社ひので製菓", "ひので製菓", "hinode-seika"),
  c("株式会社まほろば不動産", "まほろば不動産", "mahoroba-fudosan"),
  c("株式会社いずも工業", "いずも工業", "izumo-kogyo"),
  c("株式会社かすみ電子", "かすみ電子", "kasumi-denshi"),
  c("株式会社さざんか保険", "さざんか保険", "sazanka-hoken"),
  c("株式会社つつじ住建", "つつじ住建", "tsutsuji-juken"),
  c("株式会社ほたる企画", "ほたる企画", "hotaru-kikaku"),
  c("株式会社みやび呉服", "みやび呉服", "miyabi-gofuku"),
  c("株式会社ゆきわり食品", "ゆきわり食品", "yukiwari-foods"),
  c("株式会社らいむ情報", "らいむ情報", "raimu-joho"),
  c("株式会社わだち運送", "わだち運送", "wadachi-unso"),
  c("株式会社あまね会計", "あまね会計", "amane-kaikei"),
  c("株式会社えにし不動産", "えにし不動産", "enishi-fudosan"),
  c("株式会社おおぞら航測", "おおぞら航測", "ozora-kosoku"),
  c("株式会社きらら美容", "きらら美容", "kirara-biyo"),
  c("株式会社くれは化学", "くれは化学", "kureha-kagaku"),
  c("株式会社けやき建築", "けやき建築", "keyaki-kenchiku"),
  c("株式会社しののめ出版", "しののめ出版", "shinonome-pub"),
  c("株式会社すばる光学", "すばる光学", "subaru-kogaku"),
  c("株式会社せせらぎ温泉", "せせらぎ温泉", "seseragi-onsen"),
  c("株式会社たまゆら写真", "たまゆら写真", "tamayura-photo"),
  c("株式会社ちとせ製パン", "ちとせ製パン", "chitose-bakery"),
  c("株式会社つきみ酒造", "つきみ酒造", "tsukimi-shuzo"),
  c("株式会社なごみ介護", "なごみ介護", "nagomi-kaigo"),
  c("株式会社にじいろ玩具", "にじいろ玩具", "nijiiro-toys"),
  c("株式会社ぬくもり住宅", "ぬくもり住宅", "nukumori-jutaku"),
  c("株式会社はなみずき歯科", "はなみずき歯科", "hanamizuki-dental"),
  c("株式会社ふじなみ工芸", "ふじなみ工芸", "fujinami-kogei"),
];

/** Sales Cloud にはまだいない会社(EC で会社のアドレスを使ってギフトを買っている人の勤め先) */
export const PROSPECT_COMPANIES: Company[] = [
  c("株式会社かのん産業", "かのん産業", "kanon-sangyo"),
  c("株式会社あさぎ物産", "あさぎ物産", "asagi-bussan"),
  c("株式会社いぶき製薬", "いぶき製薬", "ibuki-seiyaku"),
  c("株式会社うららか保育", "うららか保育", "urara-hoiku"),
  c("株式会社えびす商事", "えびす商事", "ebisu-shoji"),
  c("株式会社おとわ楽器", "おとわ楽器", "otowa-gakki"),
  c("株式会社かざぐるま企画", "かざぐるま企画", "kazaguruma"),
  c("株式会社きぬた織物", "きぬた織物", "kinuta-orimono"),
  c("株式会社こがね精米", "こがね精米", "kogane-seimai"),
  c("株式会社さつき造園", "さつき造園", "satsuki-zoen"),
  c("株式会社しずか法務", "しずか法務", "shizuka-homu"),
  c("株式会社たかね電工", "たかね電工", "takane-denko"),
];

export const CONTACT_TITLES: (readonly [{ department: string; title: string }, number])[] = [
  [{ department: "総務部", title: "課長" }, 5],
  [{ department: "総務部", title: "主任" }, 4],
  [{ department: "総務部", title: "部長" }, 2],
  [{ department: "人事部", title: "課長" }, 2],
  [{ department: "経営企画室", title: "室長" }, 1],
  [{ department: "秘書室", title: "" }, 2],
  [{ department: "", title: "代表取締役" }, 1],
];
