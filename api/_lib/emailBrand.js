export const APP_URL = 'https://tahanote.com';
export const LOGO_CID = 'tahanote-logo';

/** Inline logo attachment for Resend (CID embedding — works in Gmail etc.). */
export function logoAttachment() {
  return {
    path: `${APP_URL}/logo.png`,
    filename: 'logo.png',
    content_id: LOGO_CID,
    content_type: 'image/png',
  };
}

export function emailHeaderHtml() {
  return `<table role="presentation" cellspacing="0" cellpadding="0"><tr>
          <td style="width:42px;height:42px;vertical-align:middle">
            <img src="cid:${LOGO_CID}" alt="Taha Note" width="42" height="42" style="display:block;border:0;border-radius:10px" />
          </td>
          <td style="padding-left:12px;font-size:22px;font-weight:800;color:#5148c9;vertical-align:middle">Taha Note</td>
        </tr></table>`;
}
