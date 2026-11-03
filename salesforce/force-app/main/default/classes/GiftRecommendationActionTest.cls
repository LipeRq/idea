@IsTest
private class GiftRecommendationActionTest {
  @TestSetup
  static void setup() {
    Map<String, Integer> prices = new Map<String, Integer>{
      'T-GFT-001' => 2700,
      'T-GFT-003' => 5400,
      'T-GFT-005' => 3780,
      'T-GFT-006' => 540,
      'T-GFT-007' => 3240,
      'T-GFT-098' => 3000,
      'T-GFT-099' => 3500,
      'T-TEA-001' => 4950,
      'T-SEN-001' => 1620
    };
    List<Product2> products = new List<Product2>{
      gift('T-GFT-001', '煎茶2種ギフト', 'Ochugen;Oseibo;Uchiiwai', true, 'Medium', 180),
      gift('T-GFT-003', '玉露と煎茶の詰め合わせ', 'Ochugen;Oseibo;Anniversary', true, 'High', 180),
      gift('T-GFT-005', '季節の三種詰め合わせ', 'Ochugen;Oseibo', true, 'Medium', 180),
      gift('T-GFT-006', 'プチギフト', 'Uchiiwai;Novelty', false, 'Medium', 365),
      gift('T-GFT-007', 'カフェインレス詰め合わせ', 'Ochugen;Oseibo;Uchiiwai', true, 'Low', 180),
      gift('T-GFT-098', '日持ちしないギフト', 'Oseibo', true, 'Medium', 30),
      gift('T-TEA-001', '急須', 'Uchiiwai;Anniversary', true, null, null)
    };
    Product2 discontinued = gift('T-GFT-099', '販売終了のギフト', 'Oseibo', true, 'Medium', 180);
    discontinued.IsActive = false;
    products.add(discontinued);
    products.add(
      new Product2(Name = '煎茶(ギフト対象外)', ProductCode = 'T-SEN-001', IsActive = true, GiftEligible__c = false)
    );
    insert products;

    List<PricebookEntry> entries = new List<PricebookEntry>();
    for (Product2 p : products) {
      entries.add(
        new PricebookEntry(
          Pricebook2Id = Test.getStandardPricebookId(),
          Product2Id = p.Id,
          UnitPrice = prices.get(p.ProductCode),
          IsActive = true
        )
      );
    }
    insert entries;
  }

  static Product2 gift(
    String code,
    String name,
    String occasions,
    Boolean noshi,
    String caffeine,
    Integer shelfLifeDays
  ) {
    return new Product2(
      Name = name,
      ProductCode = code,
      IsActive = true,
      GiftEligible__c = true,
      GiftOccasions__c = occasions,
      NoshiAvailable__c = noshi,
      CaffeineLevel__c = caffeine,
      ShelfLifeDays__c = shelfLifeDays
    );
  }

  static GiftRecommendationAction.Request request(String occasion, Integer budget, Integer quantity) {
    GiftRecommendationAction.Request req = new GiftRecommendationAction.Request();
    req.occasion = occasion;
    req.budgetPerItem = budget;
    req.quantity = quantity;
    return req;
  }

  static GiftRecommendationAction.Result run(GiftRecommendationAction.Request req) {
    List<GiftRecommendationAction.Result> results;
    System.runAs(ShizukuTestUsers.agentUser()) {
      Test.startTest();
      results = GiftRecommendationAction.recommend(new List<GiftRecommendationAction.Request>{ req });
      Test.stopTest();
    }
    Assert.areEqual(1, results.size());
    return results[0];
  }

  @IsTest
  static void returnsUpToThreeCandidatesClosestToBudget() {
    GiftRecommendationAction.Result res = run(request('Oseibo', 5400, 3));

    Assert.isTrue(res.found);
    // 日持ちしない商品・販売終了の商品・ギフト対象外の商品は出さない。予算に近い順
    Assert.areEqual(new List<String>{ 'T-GFT-003', 'T-GFT-005', 'T-GFT-007' }, res.productCodes);
    Assert.isTrue(
      res.candidatesText.startsWith('1. 玉露と煎茶の詰め合わせ(T-GFT-003) 5,400円(税込・送料別)/のし対応'),
      res.candidatesText
    );
    Assert.isFalse(res.needsCorporateDesk);
    Assert.isNull(res.note);
  }

  @IsTest
  static void filtersByNoshiAndDecaf() {
    GiftRecommendationAction.Request req = request('Uchiiwai', 3500, 2);
    req.needsNoshi = true;
    req.decafOnly = true;

    GiftRecommendationAction.Result res = run(req);

    Assert.areEqual(new List<String>{ 'T-GFT-007' }, res.productCodes);
    Assert.isTrue(res.candidatesText.contains('カフェインレス'), res.candidatesText);
  }

  @IsTest
  static void widensToCheaperItemsWithNote() {
    GiftRecommendationAction.Result res = run(request('Novelty', 3000, 100));

    Assert.isTrue(res.found);
    Assert.areEqual(new List<String>{ 'T-GFT-006' }, res.productCodes);
    Assert.isTrue(res.note.contains('半分より安い'), res.note);
    Assert.isTrue(res.needsCorporateDesk);
  }

  @IsTest
  static void reportsWhenNothingMatches() {
    GiftRecommendationAction.Result res = run(request('Ochugen', 1000, 1));

    Assert.isFalse(res.found);
    Assert.isTrue(res.productCodes.isEmpty());
    Assert.isTrue(res.note.contains('見つかりませんでした'), res.note);
  }

  @IsTest
  static void asksAgainForInvalidInput() {
    Assert.isTrue(GiftRecommendationAction.validate(request('Birthday', 3000, 1)).contains('用途'));
    Assert.isTrue(GiftRecommendationAction.validate(request(null, 3000, 1)).contains('用途'));
    Assert.isTrue(GiftRecommendationAction.validate(request('Oseibo', 0, 1)).contains('予算'));
    Assert.isTrue(GiftRecommendationAction.validate(request('Oseibo', 3000, 0)).contains('個数'));
    Assert.isNull(GiftRecommendationAction.validate(request('Oseibo', 3000, 1)));

    GiftRecommendationAction.Result res = run(request('Oseibo', null, 1));
    Assert.isFalse(res.found);
    Assert.isTrue(res.note.contains('予算'), res.note);
  }

  @IsTest
  static void flagsCorporateDeskFromTenItems() {
    Assert.isFalse(
      run(request('Oseibo', 5400, GiftRecommendationAction.CORPORATE_DESK_QUANTITY - 1)).needsCorporateDesk
    );
  }

  @IsTest
  static void flagsCorporateDeskAtThreshold() {
    Assert.isTrue(run(request('Oseibo', 5400, GiftRecommendationAction.CORPORATE_DESK_QUANTITY)).needsCorporateDesk);
  }

  @IsTest
  static void answersEachRequestInOrder() {
    List<GiftRecommendationAction.Result> results;
    System.runAs(ShizukuTestUsers.agentUser()) {
      results = GiftRecommendationAction.recommend(
        new List<GiftRecommendationAction.Request>{ request('Anniversary', 6000, 1), request('Birthday', 3000, 1) }
      );
    }
    Assert.areEqual(2, results.size());
    Assert.areEqual(new List<String>{ 'T-GFT-003', 'T-TEA-001' }, results[0].productCodes);
    Assert.isFalse(results[1].found);
  }

  @IsTest
  static void formatsYenWithoutLocale() {
    Assert.areEqual('540円', GiftRecommendationAction.formatYen(540));
    Assert.areEqual('5,400円', GiftRecommendationAction.formatYen(5400));
    Assert.areEqual('1,234,567円', GiftRecommendationAction.formatYen(1234567));
  }
}
