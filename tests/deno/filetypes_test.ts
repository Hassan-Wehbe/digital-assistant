// The upload page's file checks and Visio text extractor (docs/files/filetypes.js).
// A small .vsdx is built here: a real zip, deflated with CompressionStream, laid
// out the way Visio writes one (pages.xml names the pages and points to page files).
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  checkFile, extractVsdxText, MAX_BYTES, sniff, storageName, typeFromName, zipEntries, zipRead,
} from "../../docs/files/filetypes.js";

const enc = new TextEncoder();

async function deflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A minimal zip writer (no CRCs: the reader does not check them). */
async function zip(files: Array<[string, string, boolean?]>): Promise<Uint8Array> {
  const parts: number[] = [];
  const central: number[] = [];
  const le = (n: number, bytes: number) => Array.from({ length: bytes }, (_, i) => (n >>> (8 * i)) & 0xff);
  for (const [name, text, stored] of files) {
    const raw = enc.encode(text);
    const data = stored ? raw : await deflate(raw);
    const nm = [...enc.encode(name)];
    const method = stored ? 0 : 8;
    const offset = parts.length;
    parts.push(...le(0x04034b50, 4), ...le(20, 2), ...le(0, 2), ...le(method, 2), ...le(0, 4), ...le(0, 4),
               ...le(data.length, 4), ...le(raw.length, 4), ...le(nm.length, 2), ...le(0, 2), ...nm, ...data);
    central.push(...le(0x02014b50, 4), ...le(20, 2), ...le(20, 2), ...le(0, 2), ...le(method, 2), ...le(0, 4),
                 ...le(0, 4), ...le(data.length, 4), ...le(raw.length, 4), ...le(nm.length, 2), ...le(0, 2),
                 ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 4), ...le(offset, 4), ...nm);
  }
  const cdOffset = parts.length;
  return new Uint8Array([...parts, ...central, ...le(0x06054b50, 4), ...le(0, 2), ...le(0, 2),
                         ...le(files.length, 2), ...le(files.length, 2), ...le(central.length, 4),
                         ...le(cdOffset, 4), ...le(0, 2)]);
}

const PAGES_XML = `<?xml version='1.0' encoding='utf-8' ?>
<Pages xmlns='http://schemas.microsoft.com/office/visio/2012/main' xmlns:r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'>
<Page ID='0' NameU='Page-1' Name='Call flow' ViewScale='1'><PageSheet/><Rel r:id='rId1'/></Page>
<Page ID='4' NameU='Page-2' Name='Fallback &amp; DR'><PageSheet/><Rel r:id='rId2'/></Page>
</Pages>`;
const RELS = `<?xml version='1.0' encoding='utf-8' ?>
<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'>
<Relationship Id='rId1' Type='http://schemas.microsoft.com/visio/2010/relationships/page' Target='page2.xml'/>
<Relationship Id='rId2' Type='http://schemas.microsoft.com/visio/2010/relationships/page' Target='page1.xml'/>
</Relationships>`;
// Page 1 is the second file: page order must follow pages.xml, not file names.
const PAGE_CALL_FLOW = `<PageContents><Shapes>
<Shape ID='1' Type='Shape'><Cell N='PinX' V='1'/><Text><cp IX='0'/>Ingress trunk</Text></Shape>
<Shape ID='2' Type='Shape'><Text><cp IX='0'/>SBC
<pp IX='1'/>falcon  queue</Text></Shape>
<Shape ID='3' Type='Shape'><Text>overflow &lt;30s&gt;</Text></Shape>
<Shape ID='4' Type='Shape'><Text>SBC</Text></Shape>
</Shapes></PageContents>`;
const PAGE_DR = `<PageContents><Shapes><Shape ID='0'><Text/></Shape><Shape ID='1'><Text>Kestrel DR site &#8211; caf&#xE9;</Text></Shape></Shapes></PageContents>`;

async function vsdx(extra: Array<[string, string, boolean?]> = []) {
  return await zip([
    ["[Content_Types].xml", "<Types/>", true],
    ["visio/document.xml", "<VisioDocument/>", true],
    ["visio/pages/pages.xml", PAGES_XML],
    ["visio/pages/_rels/pages.xml.rels", RELS],
    ["visio/pages/page1.xml", PAGE_DR],
    ["visio/pages/page2.xml", PAGE_CALL_FLOW],
    ...extra,
  ]);
}

Deno.test("extractVsdxText reads page names and shape/connector text in page order", async () => {
  const text = await extractVsdxText(await vsdx());
  assertEquals(text, [
    "Page: Call flow", "Ingress trunk", "SBC", "falcon queue", "overflow <30s>", "",
    "Page: Fallback & DR", "Kestrel DR site – café",
  ].join("\n"));
});

Deno.test("extractVsdxText falls back to page files when pages.xml is missing", async () => {
  const bytes = await zip([
    ["visio/document.xml", "<VisioDocument/>", true],
    ["visio/pages/page2.xml", PAGE_DR],
    ["visio/pages/page1.xml", PAGE_CALL_FLOW],
  ]);
  const text = await extractVsdxText(bytes);
  assert(text.startsWith("Page: Page 1\nIngress trunk"), text);
  assert(text.includes("Page: Page 2\nKestrel DR site"), text);
});

Deno.test("extractVsdxText refuses a zip that is not a Visio drawing", async () => {
  const bytes = await zip([["word/document.xml", "<w:document/>"]]);
  await assertRejects(() => extractVsdxText(bytes), Error, "not a Visio drawing");
  await assertRejects(() => extractVsdxText(enc.encode("PK\x03\x04 not really a zip")), Error, "not a zip");
});

Deno.test("zipRead stops inflating past its limit (zip bombs)", async () => {
  const bytes = await zip([["big.xml", "x".repeat(200_000)]]);
  const [entry] = zipEntries(bytes);
  assert(entry.compressedSize < 2000, "compresses well");
  await assertRejects(() => zipRead(bytes, entry, 50_000), Error, "too large");
  assertEquals((await zipRead(bytes, entry)).length, 200_000);
});

Deno.test("extracted text is capped at 40000 characters", async () => {
  const long = `<PageContents><Shapes>${
    Array.from({ length: 5000 }, (_, i) => `<Shape><Text>label number ${i} here</Text></Shape>`).join("")
  }</Shapes></PageContents>`;
  const text = await extractVsdxText(await zip([
    ["visio/document.xml", "<VisioDocument/>", true],
    ["visio/pages/page1.xml", long],
  ]));
  assertEquals(text.length, 40000);
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

Deno.test("file types come from the first bytes and must match the extension", () => {
  assertEquals([sniff(PNG), sniff(JPEG), sniff(ZIP), sniff(OLE), sniff(new Uint8Array([1, 2, 3]))],
    ["png", "jpeg", "zip", "ole", null]);
  assertEquals(checkFile("a.png", PNG, 10).mime, "image/png");
  assertEquals(checkFile("a.JPG", JPEG, 10).mime, "image/jpeg");
  assertEquals(checkFile("a.jpeg", JPEG, 10).mime, "image/jpeg");
  assertEquals(checkFile("a.vsdx", ZIP, 10).mime, "application/vnd.ms-visio.drawing");
  assertEquals(checkFile("a.vsd", OLE, 10).mime, "application/vnd.visio");
  assert(!checkFile("a.jpg", PNG, 10).ok, "PNG bytes named .jpg");
  assert(!checkFile("a.png", ZIP, 10).ok, "zip named .png");
  assert(!checkFile("a.vsdx", OLE, 10).ok, "old Visio named .vsdx");
  assert(!checkFile("a.docx", ZIP, 10).ok, "other types");
  assert(!checkFile("a.tiff", new Uint8Array([0x49, 0x49, 0x2a, 0]), 10).ok, "TIFF comes later");
  assert(!checkFile("a.png", PNG, MAX_BYTES + 1).ok, "over 20 MB");
  assert(!checkFile("x".repeat(197) + ".png", PNG, 10).ok, "name over 200 characters");
  assert(checkFile("x".repeat(196) + ".png", PNG, 10).ok, "name of 200 characters");
  assertEquals(typeFromName("noext"), null);
});

Deno.test("storage names are safe and keep the extension", () => {
  assertEquals(storageName("Routing v2 (final).VSDX"), "Routing_v2_final.vsdx");
  assertEquals(storageName("Café menu.png"), "Cafe_menu.png");
  assertEquals(storageName("###.jpg"), "file.jpg");
  assertEquals(storageName("../../etc/passwd.png"), "etc_passwd.png");
  assert(/^[A-Za-z0-9._-]{1,120}$/.test(storageName("x".repeat(300) + ".jpeg")));
  assert(storageName("x".repeat(300) + ".jpeg").endsWith(".jpeg"));
});
