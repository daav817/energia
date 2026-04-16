/**
 * HTML marketing / Outlook emails often ship with &lt;style&gt; blocks that set
 * `td { display: block !important }` for narrow viewports. Those rules are appended
 * after our global CSS, so they win and every cell stacks in one column.
 *
 * Appending this fragment *after* the message HTML makes our table rules load last
 * so tabular layout matches Gmail / Outlook for typical messages.
 */
const EMAIL_TABLE_FIX_ATTR = "data-energia-email-table-fix";

const EMAIL_BODY_TABLE_LAYOUT_FIX = `<style type="text/css" ${EMAIL_TABLE_FIX_ATTR}>
.email-html-body table { display: table !important; width: 100% !important; border-collapse: collapse !important; table-layout: auto !important; }
.email-html-body tbody { display: table-row-group !important; }
.email-html-body thead { display: table-header-group !important; }
.email-html-body tr { display: table-row !important; }
.email-html-body td,
.email-html-body th { display: table-cell !important; vertical-align: top !important; }
</style>`;

export function appendEmailBodyLayoutFix(html: string): string {
  if (!html.trim()) return html;
  if (html.includes(EMAIL_TABLE_FIX_ATTR)) return html;
  return html + EMAIL_BODY_TABLE_LAYOUT_FIX;
}
