import { InventoryApp } from "@/components/InventoryApp";
import { engineAsset, samples } from "@/lib/generated";
import { contactUrl, diagnosisUrl, operatorName, privacyPolicyUrl, termsUrl } from "@/lib/site";

// ページは静的に生成する。サンプルの一覧と Worker の URL はビルド前の準備(scripts/prepare.mjs)が作ったファイルから読む
export default function Home() {
  return (
    <InventoryApp
      samples={samples()}
      workerUrl={engineAsset().workerUrl}
      contactUrl={contactUrl()}
      diagnosisUrl={diagnosisUrl()}
      privacyUrl={privacyPolicyUrl()}
      termsUrl={termsUrl()}
      operatorName={operatorName()}
    />
  );
}
