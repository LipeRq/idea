@IsTest
private class CorporateGiftLeadActionTest {
  static CorporateGiftLeadAction.Request request(String email) {
    CorporateGiftLeadAction.Request req = new CorporateGiftLeadAction.Request();
    req.company = '株式会社のぞみ技研(架空)';
    req.lastName = '田中';
    req.firstName = '直美';
    req.email = email;
    req.phone = '090-0123-4567';
    req.quantity = 120;
    req.budgetPerItem = 3240;
    req.occasion = 'Oseibo';
    req.desiredDeliveryDate = Date.today().addDays(40);
    req.summary = 'お歳暮として取引先120件。のし希望。';
    return req;
  }

  static List<CorporateGiftLeadAction.Result> run(List<CorporateGiftLeadAction.Request> requests) {
    List<CorporateGiftLeadAction.Result> results;
    System.runAs(ShizukuTestUsers.agentUser()) {
      Test.startTest();
      results = CorporateGiftLeadAction.register(requests);
      Test.stopTest();
    }
    Assert.areEqual(requests.size(), results.size());
    return results;
  }

  @IsTest
  static void registersLeadForCorporateDesk() {
    CorporateGiftLeadAction.Result res = run(
      new List<CorporateGiftLeadAction.Request>{ request(' Tanaka.Naomi@Nozomi-Giken.example ') }
    )[0];

    Assert.isTrue(res.success);
    Assert.isFalse(res.duplicate);
    Assert.areEqual(CorporateGiftLeadAction.MESSAGE_SUCCESS, res.message);
    Lead created = [
      SELECT Company, Email, GiftQuantity__c, GiftBudgetPerItem__c, GiftOccasion__c, InquiryChannel__c, InquiryDate__c
      FROM Lead
      WHERE Id = :res.leadId
    ];
    Assert.areEqual('tanaka.naomi@nozomi-giken.example', created.Email);
    Assert.areEqual(120, created.GiftQuantity__c.intValue());
    Assert.areEqual(3240, created.GiftBudgetPerItem__c.intValue());
    Assert.areEqual('Oseibo', created.GiftOccasion__c);
    Assert.areEqual('Agentforce', created.InquiryChannel__c);
    Assert.areEqual(Date.today(), created.InquiryDate__c);
  }

  @IsTest
  static void returnsRecentLeadInsteadOfDuplicating() {
    Lead existing = new Lead(
      Company = '株式会社のぞみ技研(架空)',
      LastName = '田中',
      Email = 'tanaka@nozomi-giken.example'
    );
    insert existing;

    CorporateGiftLeadAction.Result res = run(
      new List<CorporateGiftLeadAction.Request>{ request('TANAKA@nozomi-giken.example') }
    )[0];

    Assert.isTrue(res.success);
    Assert.isTrue(res.duplicate);
    Assert.areEqual(existing.Id, res.leadId);
    Assert.areEqual(CorporateGiftLeadAction.MESSAGE_DUPLICATE, res.message);
    Assert.areEqual(1, [SELECT COUNT() FROM Lead]);
  }

  @IsTest
  static void asksAgainForInvalidInput() {
    CorporateGiftLeadAction.Request badEmail = request('tanaka@');
    CorporateGiftLeadAction.Request pastDate = request('a@nozomi-giken.example');
    pastDate.desiredDeliveryDate = Date.today().addDays(-1);
    CorporateGiftLeadAction.Request noCompany = request('b@nozomi-giken.example');
    noCompany.company = ' ';
    CorporateGiftLeadAction.Request badPhone = request('c@nozomi-giken.example');
    badPhone.phone = 'お昼すぎに電話ください';

    List<CorporateGiftLeadAction.Result> results = run(
      new List<CorporateGiftLeadAction.Request>{ badEmail, pastDate, noCompany, badPhone }
    );

    Assert.isTrue(results[0].message.contains('メールアドレス'), results[0].message);
    Assert.isTrue(results[1].message.contains('過去'), results[1].message);
    Assert.isTrue(results[2].message.contains('会社名'), results[2].message);
    Assert.isTrue(results[3].message.contains('電話番号'), results[3].message);
    for (CorporateGiftLeadAction.Result res : results) {
      Assert.isFalse(res.success);
      Assert.isNull(res.leadId);
    }
    Assert.areEqual(0, [SELECT COUNT() FROM Lead]);
  }

  @IsTest
  static void registersOnceForSameEmailInOneBatch() {
    CorporateGiftLeadAction.Request invalid = request('d@nozomi-giken.example');
    invalid.quantity = 0;

    List<CorporateGiftLeadAction.Result> results = run(
      new List<CorporateGiftLeadAction.Request>{
        request('same@nozomi-giken.example'),
        request('Same@Nozomi-Giken.example'),
        invalid
      }
    );

    Assert.isTrue(results[0].success);
    Assert.isFalse(results[0].duplicate);
    Assert.isTrue(results[1].duplicate);
    Assert.areEqual(results[0].leadId, results[1].leadId);
    Assert.isFalse(results[2].success);
    Assert.areEqual(1, [SELECT COUNT() FROM Lead]);
  }

  @IsTest
  static void leavesUnknownOccasionEmpty() {
    CorporateGiftLeadAction.Request req = request('e@nozomi-giken.example');
    req.occasion = 'Birthday';

    CorporateGiftLeadAction.Result res = run(new List<CorporateGiftLeadAction.Request>{ req })[0];

    Assert.isTrue(res.success);
    Assert.isNull([SELECT GiftOccasion__c FROM Lead WHERE Id = :res.leadId].GiftOccasion__c);
  }
}
