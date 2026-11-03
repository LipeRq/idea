/**
 * ギフト相談エージェント(Agentforce)のアクション:条件に合うギフト商品を最大 3 件選ぶ。
 *
 * 金額・のし・カフェインレスの条件で「出してよい商品」を決めるのはこのクラス(プログラム)で、
 * AI には、ここが返した候補をお客さまに説明することだけを任せる。
 * 同じ条件なら、いつ聞いても同じ候補が同じ順で返る。
 */
public with sharing class GiftRecommendationAction {
  /** 用途の選択リスト(グローバル値セット GiftOccasion)の API 名 */
  public static final Set<String> OCCASIONS = new Set<String>{
    'Ochugen',
    'Oseibo',
    'Uchiiwai',
    'Anniversary',
    'Novelty'
  };
  @TestVisible
  static final Integer MAX_RESULTS = 3;
  /** この個数以上は、法人・大口の窓口(担当者)にもつなぐ */
  @TestVisible
  static final Integer CORPORATE_DESK_QUANTITY = 10;
  /** 予算の半分より安い商品は、まず候補にしない(予算に見合わない提案を避ける) */
  static final Decimal LOWER_BUDGET_RATIO = 0.5;
  /** 届いてから日持ちしないものは贈らない */
  static final Integer MIN_SHELF_LIFE_DAYS = 60;
  static final Integer MIN_BUDGET = 300;
  static final Integer MAX_BUDGET = 100000;
  static final Integer MAX_QUANTITY = 5000;

  public class Request {
    @InvocableVariable(
      label='用途'
      description='Ochugen(お中元)・Oseibo(お歳暮)・Uchiiwai(内祝い)・Anniversary(周年記念)・Novelty(ノベルティ)のいずれか'
      required=true
    )
    public String occasion;

    @InvocableVariable(
      label='1件あたりの予算(円・税込)'
      description='送り先 1 件あたりの上限の金額。送料は含めない'
      required=true
    )
    public Integer budgetPerItem;

    @InvocableVariable(label='個数(送り先の数)' description='贈る相手の数' required=true)
    public Integer quantity;

    @InvocableVariable(label='のしが必要か' description='お客さまがのし紙を希望しているとき true')
    public Boolean needsNoshi;

    @InvocableVariable(
      label='カフェインレスを希望するか'
      description='お客さまがカフェインレスの商品を希望しているとき true'
    )
    public Boolean decafOnly;
  }

  public class Result {
    @InvocableVariable(label='候補が見つかったか')
    public Boolean found;

    @InvocableVariable(
      label='候補の一覧'
      description='お客さまへの案内にそのまま使える、番号つきの候補(商品名・価格・のし・日持ち)'
    )
    public String candidatesText;

    @InvocableVariable(label='候補の商品コード')
    public List<String> productCodes;

    @InvocableVariable(
      label='法人・大口の窓口への案内が必要か'
      description='true のときは、法人・大口の相談としても受け付けられることを案内する'
    )
    public Boolean needsCorporateDesk;

    @InvocableVariable(label='補足' description='入力の不足、見つからなかった理由、予算より安い候補しかないことなど')
    public String note;
  }

  @InvocableMethod(
    label='ギフト商品の候補を探す'
    description='用途・1件あたりの予算・個数・のし・カフェインレスの条件から、ギフト対応の商品を最大3件返す。価格は税込の定価。在庫・納期・値引きは約束しない。'
    category='しずく茶舗'
  )
  public static List<Result> recommend(List<Request> requests) {
    List<Candidate> catalog = loadCatalog();
    List<Result> results = new List<Result>();
    for (Request req : requests) {
      results.add(recommendOne(req, catalog));
    }
    return results;
  }

  static Result recommendOne(Request req, List<Candidate> catalog) {
    Result res = new Result();
    res.found = false;
    res.candidatesText = '';
    res.productCodes = new List<String>();
    res.needsCorporateDesk = false;

    String problem = validate(req);
    if (problem != null) {
      res.note = problem;
      return res;
    }
    res.needsCorporateDesk = req.quantity >= CORPORATE_DESK_QUANTITY;

    List<Candidate> matches = filter(catalog, req, LOWER_BUDGET_RATIO);
    if (matches.isEmpty()) {
      // 予算に近いものがないときだけ、安い候補まで広げる(そのことを補足で伝える)
      matches = filter(catalog, req, 0);
      if (!matches.isEmpty()) {
        res.note = 'ご予算の半分より安い商品しか見つかりませんでした。ご予算を変えるか、法人・大口の窓口で組み合わせをご相談いただけます。';
      }
    }
    if (matches.isEmpty()) {
      res.note = '条件に合うギフト商品が見つかりませんでした。ご予算・のしの有無・カフェインレスの条件のどれを緩められるか、お客さまに確認してください。';
      return res;
    }

    matches.sort();
    List<String> lines = new List<String>();
    for (Integer i = 0; i < Math.min(MAX_RESULTS, matches.size()); i++) {
      Candidate c = matches[i];
      res.productCodes.add(c.code);
      lines.add(c.describe(i + 1));
    }
    res.found = true;
    res.candidatesText = String.join(lines, '\n');
    return res;
  }

  @TestVisible
  static String validate(Request req) {
    if (req == null || req.occasion == null || !OCCASIONS.contains(req.occasion)) {
      return '用途が分かりません。お中元・お歳暮・内祝い・周年記念・ノベルティのどれかを確認してください。';
    }
    if (req.budgetPerItem == null || req.budgetPerItem < MIN_BUDGET || req.budgetPerItem > MAX_BUDGET) {
      return '1件あたりのご予算(300円〜100,000円)を確認してください。';
    }
    if (req.quantity == null || req.quantity < 1 || req.quantity > MAX_QUANTITY) {
      return '個数(1〜5,000)を確認してください。';
    }
    return null;
  }

  static List<Candidate> filter(List<Candidate> catalog, Request req, Decimal lowerRatio) {
    List<Candidate> out = new List<Candidate>();
    for (Candidate c : catalog) {
      if (c.matches(req, lowerRatio)) {
        out.add(c);
      }
    }
    return out;
  }

  static List<Candidate> loadCatalog() {
    Id pricebookId = standardPricebookId();
    List<Candidate> out = new List<Candidate>();
    for (PricebookEntry e : [
      SELECT
        UnitPrice,
        Product2.Name,
        Product2.ProductCode,
        Product2.GiftOccasions__c,
        Product2.NoshiAvailable__c,
        Product2.CaffeineLevel__c,
        Product2.ShelfLifeDays__c
      FROM PricebookEntry
      WHERE
        Pricebook2Id = :pricebookId
        AND IsActive = TRUE
        AND Product2.IsActive = TRUE
        AND Product2.GiftEligible__c = TRUE
      WITH USER_MODE
      ORDER BY Product2.ProductCode
      LIMIT 500
    ]) {
      out.add(new Candidate(e));
    }
    return out;
  }

  static Id standardPricebookId() {
    if (Test.isRunningTest()) {
      return Test.getStandardPricebookId();
    }
    return [SELECT Id FROM Pricebook2 WHERE IsStandard = TRUE WITH USER_MODE LIMIT 1].Id;
  }

  /** 3 桁区切りの円(ユーザーのロケールに左右されないよう自前で整形する) */
  @TestVisible
  static String formatYen(Integer amount) {
    String digits = String.valueOf(Math.abs(amount));
    String out = '';
    while (digits.length() > 3) {
      out = ',' + digits.right(3) + out;
      digits = digits.left(digits.length() - 3);
    }
    return (amount < 0 ? '-' : '') + digits + out + '円';
  }

  class Candidate implements Comparable {
    String name;
    String code;
    Integer price;
    Set<String> occasions = new Set<String>();
    Boolean noshi;
    String caffeine;
    Integer shelfLifeDays;

    Candidate(PricebookEntry e) {
      name = e.Product2.Name;
      code = e.Product2.ProductCode;
      price = e.UnitPrice.intValue();
      if (String.isNotBlank(e.Product2.GiftOccasions__c)) {
        occasions.addAll(e.Product2.GiftOccasions__c.split(';'));
      }
      noshi = e.Product2.NoshiAvailable__c == true;
      caffeine = e.Product2.CaffeineLevel__c;
      shelfLifeDays = e.Product2.ShelfLifeDays__c == null ? null : e.Product2.ShelfLifeDays__c.intValue();
    }

    Boolean matches(Request req, Decimal lowerRatio) {
      if (!occasions.contains(req.occasion)) {
        return false;
      }
      if (price > req.budgetPerItem || price < req.budgetPerItem * lowerRatio) {
        return false;
      }
      if (req.needsNoshi == true && !noshi) {
        return false;
      }
      if (req.decafOnly == true && caffeine != 'Low') {
        return false;
      }
      return shelfLifeDays == null || shelfLifeDays >= MIN_SHELF_LIFE_DAYS;
    }

    /** 予算に近い(高い)順。同じ価格なら商品コード順 */
    public Integer compareTo(Object other) {
      Candidate o = (Candidate) other;
      if (price != o.price) {
        return price > o.price ? -1 : 1;
      }
      return code.compareTo(o.code);
    }

    String describe(Integer rank) {
      List<String> facts = new List<String>{ formatYen(price) + '(税込・送料別)' };
      facts.add(noshi ? 'のし対応' : 'のし不可');
      if (caffeine == 'Low') {
        facts.add('カフェインレス');
      }
      if (shelfLifeDays != null) {
        facts.add('賞味期限の目安 ' + shelfLifeDays + '日');
      }
      return String.valueOf(rank) + '. ' + name + '(' + code + ')' + ' ' + String.join(facts, '/');
    }
  }
}
