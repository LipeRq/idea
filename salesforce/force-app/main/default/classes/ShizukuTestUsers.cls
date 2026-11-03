/**
 * テスト用のユーザー。エージェントのユーザーと同じ権限セット(GiftConcierge_Agent)を割り当てる。
 * 新しい項目の項目レベルセキュリティは権限セットで付与しているので、権限セットのないユーザーでは USER_MODE の検索が失敗する。
 */
@IsTest
public class ShizukuTestUsers {
  public static User agentUser() {
    String unique = String.valueOf(Math.abs(Crypto.getRandomInteger())) + String.valueOf(Datetime.now().getTime());
    User u = new User(
      ProfileId = UserInfo.getProfileId(),
      LastName = 'エージェント',
      FirstName = 'テスト用',
      Alias = 'tagent',
      Email = 'agent.test@example.com',
      Username = 'agent.' + unique + '@shizuku-test.example',
      TimeZoneSidKey = 'Asia/Tokyo',
      LocaleSidKey = 'ja_JP',
      EmailEncodingKey = 'UTF-8',
      LanguageLocaleKey = 'ja'
    );
    // 設定オブジェクト(User・権限セットの割り当て)の DML を、ほかの DML と混ぜないために runAs の中で行う
    System.runAs(new User(Id = UserInfo.getUserId())) {
      insert u;
      insert new PermissionSetAssignment(
        AssigneeId = u.Id,
        PermissionSetId = [SELECT Id FROM PermissionSet WHERE Name = 'GiftConcierge_Agent']
        .Id
      );
    }
    return u;
  }
}
