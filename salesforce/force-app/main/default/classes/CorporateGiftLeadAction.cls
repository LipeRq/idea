/**
 * ギフト相談エージェント(Agentforce)のアクション:法人・大口ギフトの相談を、法人営業へのリードとして登録する。
 *
 * - 入力の確認(必須・メールアドレスの形式・個数・お届け日)はここで行い、足りないときは何を聞き直すかを返す
 * - 同じメールアドレスで 30 日以内に作られた未変換のリードがあれば、新しく作らない(担当者が確認中と返す)
 * - 登録はエージェントのユーザーの権限で行う(AccessLevel.USER_MODE)。担当者はリードの割り当てルールで決める
 */
public with sharing class CorporateGiftLeadAction {
  @TestVisible
  static final Integer DUPLICATE_WINDOW_DAYS = 30;
  static final Pattern EMAIL_FORMAT = Pattern.compile('^[A-Za-z0-9._%+\\-]+@[A-Za-z0-9\\-]+(\\.[A-Za-z0-9\\-]+)+$');
  static final Pattern PHONE_FORMAT = Pattern.compile('^[0-9+\\-() ]{6,20}$');

  @TestVisible
  static final String MESSAGE_SUCCESS = '法人ギフトの担当者に引き継ぎました。2営業日以内に、担当者からメールでご連絡します。';
  @TestVisible
  static final String MESSAGE_DUPLICATE = '同じメールアドレスで最近いただいたご相談があり、担当者が確認しています。追加のご要望は、担当者からの連絡の際にお伝えください。';
  static final String MESSAGE_FAILED = '登録できませんでした。担当者から折り返すことを伝え、お問い合わせフォームのご利用をご案内してください。';

  public class Request {
    @InvocableVariable(label='会社名・団体名' required=true)
    public String company;

    @InvocableVariable(label='ご担当者の姓' required=true)
    public String lastName;

    @InvocableVariable(label='ご担当者の名')
    public String firstName;

    @InvocableVariable(label='メールアドレス' required=true)
    public String email;

    @InvocableVariable(label='電話番号')
    public String phone;

    @InvocableVariable(label='個数(送り先の数)' required=true)
    public Integer quantity;

    @InvocableVariable(label='1件あたりの予算(円・税込)')
    public Integer budgetPerItem;

    @InvocableVariable(
      label='用途'
      description='Ochugen・Oseibo・Uchiiwai・Anniversary・Novelty のいずれか。分からなければ空'
    )
    public String occasion;

    @InvocableVariable(label='希望のお届け日')
    public Date desiredDeliveryDate;

    @InvocableVariable(
      label='相談の要約'
      description='会話から分かった要望(名入れ・のし・送り先の地域など)の要約。お客さまの言葉にない内容は書かない'
    )
    public String summary;
  }

  public class Result {
    @InvocableVariable(label='登録できたか')
    public Boolean success;

    @InvocableVariable(label='最近の相談と重複していたか')
    public Boolean duplicate;

    @InvocableVariable(label='リードのID')
    public Id leadId;

    @InvocableVariable(
      label='案内に使う要点'
      description='お客さまに伝える内容。登録できなかったときは、何を確認し直すか'
    )
    public String message;
  }

  @InvocableMethod(
    label='法人・大口ギフトの相談を登録する'
    description='会社名・担当者名・メールアドレス・個数などを、法人営業へのリードとして登録する。同じメールアドレスで30日以内の相談があれば、新しく作らずにその旨を返す。'
    category='しずく茶舗'
  )
  public static List<Result> register(List<Request> requests) {
    Result[] results = new List<Result>(requests.size());

    // 1) 入力の確認
    Set<String> emails = new Set<String>();
    for (Integer i = 0; i < requests.size(); i++) {
      String problem = validate(requests[i]);
      if (problem != null) {
        results[i] = failure(problem);
      } else {
        emails.add(normalizeEmail(requests[i].email));
      }
    }

    // 2) 最近の相談との重複(メールアドレスの比較は大文字・小文字を区別しない)
    Map<String, Id> recent = new Map<String, Id>();
    if (!emails.isEmpty()) {
      Datetime since = Datetime.now().addDays(-DUPLICATE_WINDOW_DAYS);
      for (Lead l : [
        SELECT Id, Email
        FROM Lead
        WHERE Email IN :emails AND IsConverted = FALSE AND CreatedDate >= :since
        WITH USER_MODE
        ORDER BY CreatedDate DESC
      ]) {
        String key = normalizeEmail(l.Email);
        if (!recent.containsKey(key)) {
          recent.put(key, l.Id);
        }
      }
    }

    // 3) 登録(同じ依頼の中に同じメールアドレスが複数あれば、最初の 1 件だけを登録する)
    List<Lead> leads = new List<Lead>();
    List<Integer> leadIndexes = new List<Integer>();
    Map<String, Integer> firstInBatch = new Map<String, Integer>();
    for (Integer i = 0; i < requests.size(); i++) {
      if (results[i] != null) {
        continue;
      }
      String key = normalizeEmail(requests[i].email);
      if (recent.containsKey(key)) {
        results[i] = duplicateOf(recent.get(key));
      } else if (!firstInBatch.containsKey(key)) {
        firstInBatch.put(key, i);
        leads.add(toLead(requests[i]));
        leadIndexes.add(i);
      }
    }
    if (!leads.isEmpty()) {
      Database.DMLOptions options = new Database.DMLOptions();
      options.assignmentRuleHeader.useDefaultRule = true;
      options.optAllOrNone = false;
      Database.SaveResult[] saved = Database.insert(leads, options, AccessLevel.USER_MODE);
      for (Integer j = 0; j < saved.size(); j++) {
        Integer index = leadIndexes[j];
        if (saved[j].isSuccess()) {
          results[index] = success(saved[j].getId());
        } else {
          // ログに個人情報(氏名・メールアドレス)は出さない。エラーの種類だけを残す
          for (Database.Error e : saved[j].getErrors()) {
            System.debug(LoggingLevel.WARN, 'CorporateGiftLeadAction: ' + e.getStatusCode());
          }
          results[index] = failure(MESSAGE_FAILED);
        }
      }
    }
    for (Integer i = 0; i < requests.size(); i++) {
      if (results[i] == null) {
        Result first = results[firstInBatch.get(normalizeEmail(requests[i].email))];
        results[i] = first.success ? duplicateOf(first.leadId) : failure(MESSAGE_FAILED);
      }
    }
    return results;
  }

  @TestVisible
  static String validate(Request req) {
    if (req == null || String.isBlank(req.company)) {
      return '会社名(団体名)を確認してください。';
    }
    if (String.isBlank(req.lastName)) {
      return 'ご担当者のお名前(姓)を確認してください。';
    }
    if (String.isBlank(req.email) || !EMAIL_FORMAT.matcher(req.email.trim()).matches()) {
      return 'メールアドレスの形式を確認してください。';
    }
    if (String.isNotBlank(req.phone) && !PHONE_FORMAT.matcher(req.phone.trim()).matches()) {
      return '電話番号の形式を確認してください(数字とハイフンのみ)。';
    }
    if (req.quantity == null || req.quantity < 1 || req.quantity > 100000) {
      return '個数を確認してください。';
    }
    if (req.budgetPerItem != null && (req.budgetPerItem < 1 || req.budgetPerItem > 1000000)) {
      return '1件あたりのご予算を確認してください。';
    }
    if (req.desiredDeliveryDate != null && req.desiredDeliveryDate < Date.today()) {
      return '希望のお届け日が過去の日付になっています。日付を確認してください。';
    }
    return null;
  }

  static Lead toLead(Request req) {
    return new Lead(
      Company = clip(req.company, 255),
      LastName = clip(req.lastName, 80),
      FirstName = clip(req.firstName, 40),
      Email = normalizeEmail(req.email),
      Phone = clip(req.phone, 40),
      GiftQuantity__c = req.quantity,
      GiftBudgetPerItem__c = req.budgetPerItem,
      GiftOccasion__c = GiftRecommendationAction.OCCASIONS.contains(req.occasion) ? req.occasion : null,
      DesiredDeliveryDate__c = req.desiredDeliveryDate,
      InquiryChannel__c = 'Agentforce',
      InquiryDate__c = Date.today(),
      InquirySummary__c = clip(req.summary, 2000)
    );
  }

  @TestVisible
  static String normalizeEmail(String email) {
    return email == null ? null : email.trim().toLowerCase();
  }

  static String clip(String value, Integer maxLength) {
    if (String.isBlank(value)) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.length() > maxLength ? trimmed.left(maxLength) : trimmed;
  }

  static Result success(Id leadId) {
    Result r = new Result();
    r.success = true;
    r.duplicate = false;
    r.leadId = leadId;
    r.message = MESSAGE_SUCCESS;
    return r;
  }

  static Result duplicateOf(Id leadId) {
    Result r = new Result();
    r.success = true;
    r.duplicate = true;
    r.leadId = leadId;
    r.message = MESSAGE_DUPLICATE;
    return r;
  }

  static Result failure(String message) {
    Result r = new Result();
    r.success = false;
    r.duplicate = false;
    r.message = message;
    return r;
  }
}
