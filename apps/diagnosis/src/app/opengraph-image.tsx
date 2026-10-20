import { OG_IMAGE_ALT, OG_SIZE, renderOgImage } from "@/lib/og-image";
import { operatorName } from "@/lib/site";

export const alt = OG_IMAGE_ALT;
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return renderOgImage(operatorName());
}
