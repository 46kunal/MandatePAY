/**
 * PDF evidence pack for a dispute case (owner: A).
 *
 * `buildEvidenceModel` turns a CaseDetail into plain sections (pure, unit-tested). `renderEvidencePdf` draws them with
 * pdfkit. Only data we already store is used: the signed mandate's constraints, the cart, the guard result, the PayPal
 * order and capture ids, the receipt hash and the analyst's cited evidence. No secrets and no signed tokens are included.
 */
import PDFDocument from 'pdfkit';
import type { CaseDetail } from './cases';

export interface EvidenceSection {
  title: string;
  /** label / value pairs, drawn as a two column list */
  rows?: [string, string][];
  /** free paragraphs */
  paragraphs?: string[];
  /** a simple table: first row is the header */
  table?: string[][];
}

export interface EvidenceModel {
  title: string;
  subtitle: string;
  sections: EvidenceSection[];
}

const money = (value: string, currency: string) => `${value} ${currency}`;
const minor = (n: number) => (n / 100).toFixed(2);

function constraintRows(constraints: unknown): [string, string][] {
  const c = (constraints ?? {}) as Record<string, unknown>;
  const rows: [string, string][] = [];
  const max = c.max_total as { value?: string; currency?: string } | undefined;
  if (max?.value) rows.push(['Maximum total', money(max.value, max.currency ?? '')]);
  if (Array.isArray(c.categories) && c.categories.length) rows.push(['Allowed categories', c.categories.join(', ')]);
  if (typeof c.max_quantity === 'number') rows.push(['Maximum quantity', String(c.max_quantity)]);
  if (c.required_attributes && typeof c.required_attributes === 'object') {
    const attrs = Object.entries(c.required_attributes as Record<string, string>).map(([k, v]) => `${k} = ${v}`);
    if (attrs.length) rows.push(['Required details', attrs.join(', ')]);
  }
  if (typeof c.deadline === 'string') rows.push(['Delivery deadline', c.deadline]);
  if (typeof c.require_approval_over === 'string') rows.push(['Buyer approval needed over', c.require_approval_over]);
  return rows;
}

function refundedWords(r: NonNullable<CaseDetail['order']>['refunded']): string {
  if (!r) return 'Nothing refunded';
  const what = r.covers_dispute === 'full' ? 'the full disputed amount' : 'part of the disputed amount';
  return `${money(r.value, r.currency)}${r.pending ? ' (pending at PayPal)' : ''}, ${what}`;
}

function paidWith(source: string | null): string {
  if (source === 'paypal') return 'PayPal account';
  if (source === 'card') return 'Card (PayPal guest checkout)';
  return source ?? 'not recorded';
}

/** What the payer check means, in words a dispute reviewer reads. */
const PAYER_WORDS: Record<'match' | 'different' | 'not_linked' | 'unknown', string> = {
  match: 'The PayPal account that paid is the one the buyer linked to MandatePay',
  different: 'Paid by a different PayPal payer than the account the buyer linked',
  not_linked: 'The buyer has not linked a PayPal account',
  unknown: 'Payer not recorded for this order',
};

export function buildEvidenceModel(d: CaseDetail, generatedAt: Date = new Date()): EvidenceModel {
  const sections: EvidenceSection[] = [];

  sections.push({
    title: 'Dispute',
    rows: [
      ['Dispute id', d.dispute_id],
      ['Reason', d.reason ?? 'unknown'],
      ['Stage / status', `${d.stage ?? 'unknown'} / ${d.status ?? 'unknown'}`],
      ['Amount disputed', d.amount ? money(d.amount.value, d.amount.currency) : 'unknown'],
      ...(d.outcome ? ([['Outcome', d.outcome]] as [string, string][]) : []),
    ],
  });

  if (d.order) {
    sections.push({
      title: 'Payment record',
      rows: [
        ['PayPal order id', d.order.paypal_order_id],
        ['PayPal capture id', d.order.capture_id ?? 'not captured'],
        ['Order status', d.order.status],
        ['Captured at', d.order.captured_at ?? 'n/a'],
        ['Receipt hash', d.order.receipt_hash ?? 'n/a'],
        ['Paid with', paidWith(d.order.payment_source)],
        ['Payer', PAYER_WORDS[d.order.payer_check]],
        ['Refunded', refundedWords(d.order.refunded)],
      ],
    });
  }

  if (d.mandate) {
    const c = (d.mandate.constraints ?? {}) as { request_text?: string };
    sections.push({
      title: 'What the buyer authorised (signed mandate)',
      rows: [
        ['Mandate id', d.mandate.mandate_id],
        ['Buyer reference', d.mandate.buyer_ref],
        [
          'Signed with',
          d.mandate.signed_with === 'buyer_key'
            ? "This buyer's own signing key (the signature identifies the buyer)"
            : 'The shared demo key (signed before per-buyer keys)',
        ],
        ['Valid until', d.mandate.expires_at],
        ...constraintRows(d.mandate.constraints),
      ],
      paragraphs: c.request_text ? [`The buyer's own words: "${c.request_text}"`] : undefined,
    });
  }

  if (d.cart) {
    const cart = d.cart.cart as {
      merchant?: string | null;
      delivery_eta?: string | null;
      currency?: string;
      items?: { sku: string; name: string; quantity: number; unit_price: string; category?: string; attributes?: Record<string, string> }[];
    };
    const items = cart.items ?? [];
    sections.push({
      title: 'What was bought (cart)',
      rows: [
        ['Cart id', d.cart.cart_id],
        ['Merchant', cart.merchant ?? 'n/a'],
        ['Estimated delivery', cart.delivery_eta ?? 'n/a'],
        ['Total', money(minor(d.cart.total_minor), cart.currency ?? '')],
        ['Approved by', d.cart.approved_by ?? 'n/a'],
      ],
      table: [
        ['SKU', 'Item', 'Details', 'Qty', 'Unit price'],
        ...items.map((i) => [
          i.sku,
          i.name,
          Object.entries(i.attributes ?? {}).map(([k, v]) => `${k}=${v}`).join(', ') || '-',
          String(i.quantity),
          i.unit_price,
        ]),
      ],
    });

    const guard = d.cart.guard as { verdict?: string; checks?: { rule: string; status: string; detail: string }[] } | null;
    if (guard?.checks?.length) {
      sections.push({
        title: `Cart check against the mandate (${guard.verdict ?? 'n/a'})`,
        table: [['Rule', 'Result', 'Detail'], ...guard.checks.map((c) => [c.rule, c.status, c.detail])],
      });
    }
  }

  if (d.verdict) {
    sections.push({
      title: 'Case analysis',
      rows: [
        ['Assessed fault', d.verdict.fault],
        ['Recommended action', d.verdict.action + (d.verdict.offer_amount ? ` (${d.verdict.offer_amount})` : '')],
        ['Confidence', `${Math.round(d.verdict.confidence * 100)}%`],
      ],
      paragraphs: [d.verdict.reasoning],
      table: [['Claim', 'Source'], ...d.verdict.evidence_points.map((p) => [p.claim, p.source])],
    });
  }

  if (!d.mandate && !d.cart) {
    sections.push({
      title: 'Note',
      paragraphs: ['This dispute is not linked to one of our orders, so no mandate or cart evidence is available.'],
    });
  }

  return {
    title: 'MandatePay evidence pack',
    subtitle: `Case ${d.dispute_id} - generated ${generatedAt.toISOString()}`,
    sections,
  };
}

/** Flat text of the model: used by tests and as the notes sent with a provide-evidence call. */
export function evidenceModelToText(m: EvidenceModel): string {
  const out: string[] = [m.title, m.subtitle, ''];
  for (const s of m.sections) {
    out.push(s.title.toUpperCase());
    for (const [k, v] of s.rows ?? []) out.push(`${k}: ${v}`);
    for (const p of s.paragraphs ?? []) out.push(p);
    for (const row of s.table ?? []) out.push(row.join(' | '));
    out.push('');
  }
  return out.join('\n').trim();
}

export function renderEvidencePdf(m: EvidenceModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: m.title, Author: 'MandatePay' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const ensure = (h: number) => {
      if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
    };

    doc.font('Helvetica-Bold').fontSize(20).fillColor('#122140').text(m.title);
    doc.font('Helvetica').fontSize(9).fillColor('#5b6478').text(m.subtitle);
    doc.moveDown(1);

    for (const s of m.sections) {
      ensure(60);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#122140').text(s.title);
      doc.moveTo(doc.page.margins.left, doc.y + 2).lineTo(doc.page.margins.left + width, doc.y + 2).strokeColor('#d5d9e2').stroke();
      doc.moveDown(0.5);

      for (const [k, v] of s.rows ?? []) {
        ensure(16);
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#5b6478').text(k, doc.page.margins.left, y, { width: 150 });
        const afterLabel = doc.y;
        doc.font('Helvetica').fontSize(9).fillColor('#122140').text(v, doc.page.margins.left + 160, y, { width: width - 160 });
        doc.y = Math.max(afterLabel, doc.y) + 2;
      }
      for (const p of s.paragraphs ?? []) {
        ensure(30);
        doc.moveDown(0.3).font('Helvetica').fontSize(9).fillColor('#122140').text(p, doc.page.margins.left, doc.y, { width });
      }
      if (s.table?.length) {
        const cols = s.table[0].length;
        const colW = width / cols;
        s.table.forEach((row, i) => {
          const heights = row.map((cell) => doc.heightOfString(cell, { width: colW - 6 }));
          ensure(Math.max(...heights) + 6);
          const y = doc.y + 2;
          row.forEach((cell, c) => {
            doc
              .font(i === 0 ? 'Helvetica-Bold' : 'Helvetica')
              .fontSize(8)
              .fillColor(i === 0 ? '#5b6478' : '#122140')
              .text(cell, doc.page.margins.left + c * colW, y, { width: colW - 6 });
          });
          doc.y = y + Math.max(...heights) + 4;
        });
      }
      doc.moveDown(1);
    }

    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#8a91a3').text(
      'Mandates are AP2-style signed tokens stored by MandatePay. This pack lists the facts recorded at purchase time; it is not legal advice.',
      doc.page.margins.left,
      doc.y,
      { width },
    );
    doc.end();
  });
}

/** PayPal's limit for a dispute message. */
export const MAX_DISPUTE_MESSAGE = 2000;

/**
 * The evidence as a plain message to the other party, for stages where PayPal's provide-evidence is not available
 * (an inquiry only allows messages, offers and accepting). Built only from the records, so every line is a fact the
 * store can stand behind; the AI's free text is not used. Always within PayPal's message limit.
 */
export function evidenceMessageText(d: CaseDetail): string {
  const lines: string[] = [`Hello. Here is the record of this purchase (dispute ${d.dispute_id}).`];

  if (d.mandate) {
    const c = (d.mandate.constraints ?? {}) as {
      request_text?: string;
      max_total?: { value: string; currency: string };
      required_attributes?: Record<string, string>;
    };
    const ask = c.request_text ? ` for "${c.request_text}"` : '';
    const limit = c.max_total ? `, with a limit of ${money(c.max_total.value, c.max_total.currency)}` : '';
    lines.push(
      `- Before buying, the buyer signed a purchase mandate${ask}${limit}. ` +
        (d.mandate.signed_with === 'buyer_key'
          ? "It is signed with the buyer's own signing key."
          : 'It carries the store’s signature record.'),
    );
  }

  if (d.cart) {
    const cart = d.cart.cart as { currency?: string; items?: { name: string; quantity: number; attributes?: Record<string, string> }[] };
    const items = (cart.items ?? [])
      .map((i) => `${i.quantity} x ${i.name}${i.attributes && Object.keys(i.attributes).length ? ` (${Object.entries(i.attributes).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`)
      .join('; ');
    const guard = d.cart.guard as { verdict?: string; checks?: { status: string }[] } | null;
    const passed = guard?.checks?.filter((c) => c.status === 'pass').length ?? 0;
    const total = guard?.checks?.length ?? 0;
    lines.push(
      `- The order was: ${items || 'see the order'}, total ${money(minor(d.cart.total_minor), cart.currency ?? '')}.` +
        (total ? ` It passed ${passed} of ${total} checks against the buyer's mandate.` : ''),
    );
  }

  if (d.order) {
    const who =
      d.order.payer_check === 'match'
        ? 'It was paid from the PayPal account the buyer had linked to our store.'
        : d.order.payment_source === 'card'
          ? 'It was paid by card through PayPal checkout.'
          : '';
    lines.push(`- Payment ${d.order.paypal_order_id} was captured${d.order.captured_at ? ` on ${d.order.captured_at.slice(0, 10)}` : ''}. ${who}`.trimEnd());
    if (d.order.receipt_hash) lines.push(`- Receipt hash (ties the mandate, cart and payment together): ${d.order.receipt_hash}`);
    if (d.order.refunded) {
      lines.push(
        `- The store has refunded ${money(d.order.refunded.value, d.order.refunded.currency)} on this payment` +
          (d.order.refunded.pending ? ' (PayPal still shows it as pending).' : '.'),
      );
    }
  }

  lines.push(
    d.order?.refunded?.covers_dispute === 'full'
      ? 'As the full amount has been refunded, we ask that this dispute be closed.'
      : 'If something about the item is different from what was ordered, please tell us exactly what, so we can put it right.',
  );

  let text = lines.join('\n');
  if (text.length > MAX_DISPUTE_MESSAGE) text = text.slice(0, MAX_DISPUTE_MESSAGE - 1).trimEnd() + '…';
  return text;
}
