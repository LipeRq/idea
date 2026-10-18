import { Suspense } from "react";
import { ExtractionPanel } from "@/components/ExtractionPanel";
import { InquiryFrame } from "@/components/InquiryFrame";
import { Card, Loading, Notice } from "@/components/ui";
import { buildQuestionEmail } from "@/lib/extraction/rules";
import { loadInquiryView } from "@/lib/views";

export default function ExtractionPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Loading />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { inquiry, ref } = await loadInquiryView(id);
  const { extraction } = inquiry;
  const editable = inquiry.status === "extracted" || inquiry.status === "estimated";
  const option = (kind: "surface" | "heat") =>
    ref.rates.treatments.filter((t) => t.kind === kind).map((t) => ({ id: t.id, name: t.name }));

  return (
    <InquiryFrame inquiry={inquiry} step="extraction">
      {extraction.error && <Notice level="critical">{extraction.error}</Notice>}
      {extraction.mode === "demo" && (
        <Notice level="info">
          デモモードです。サンプル図面には、AIが返すのと同じ形の固定の読み取り結果を表示しています(APIキーを設定するとClaudeが実際に読み取ります)。
        </Notice>
      )}
      <Card className="space-y-3">
        <h2 className="text-lg font-bold">引き合いの要約</h2>
        <p className="text-ink-2">{extraction.summary || "—"}</p>
        <div className="grid gap-4 text-sm md:grid-cols-2">
          <div>
            <p className="font-semibold">図面</p>
            {inquiry.drawings.length === 0 ? (
              <p className="text-muted">添付なし</p>
            ) : (
              <ul className="list-disc pl-5">
                {inquiry.drawings.map((d) => (
                  <li key={d.id}>
                    <a
                      href={`/api/inquiries/${inquiry.id}/drawings/${d.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent-ink hover:underline"
                    >
                      {d.fileName}
                    </a>{" "}
                    <span className="text-muted">({Math.ceil(d.sizeBytes / 1024).toLocaleString("ja-JP")}KB)</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <details>
            <summary className="cursor-pointer font-semibold">メール(差出人:{inquiry.email.from || "未入力"})</summary>
            <p className="mt-2 font-medium">{inquiry.email.subject}</p>
            <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-ink-2">{inquiry.email.body}</pre>
          </details>
        </div>
        {extraction.spec.features.length > 0 && (
          <p className="text-sm">
            <span className="font-semibold">形状特徴:</span>
            {extraction.spec.features.join("、")}
          </p>
        )}
        {extraction.spec.notes.length > 0 && (
          <div className="text-sm">
            <p className="font-semibold">注記・要求事項</p>
            <ul className="text-ink-2">
              {extraction.spec.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>
      <ExtractionPanel
        key={inquiry.updatedAt}
        inquiryId={inquiry.id}
        fields={extraction.fields}
        spec={extraction.spec}
        questions={extraction.questions}
        questionEmail={buildQuestionEmail(extraction.spec, extraction.questions, ref.company)}
        drawings={inquiry.drawings.map((d) => ({ id: d.id, fileName: d.fileName }))}
        materials={ref.rates.materials.map((m) => ({ id: m.id, name: m.name }))}
        surfaceTreatments={option("surface")}
        heatTreatments={option("heat")}
        editable={editable}
        estimated={inquiry.similar !== null}
      />
    </InquiryFrame>
  );
}
