interface WelcomeEmailParams {
  fullName: string;
  email: string;
  password: string;
  loginUrl: string;
}

export function welcomeEmailTemplate(params: WelcomeEmailParams): string {
  const { fullName, email, password, loginUrl } = params;
  const year = new Date().getFullYear();

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    @media only screen and (max-width: 620px) {
      .outer-table { width: 100% !important; }
      .watermark-col { display: none !important; width: 0 !important; max-width: 0 !important; overflow: hidden !important; }
      .content-col { padding: 24px 20px !important; }
      .header-cell { padding: 14px 20px !important; }
      .footer-cell { padding: 14px 20px !important; }
      .greeting { font-size: 24px !important; }
      .email-text { font-size: 13px !important; word-break: break-all !important; }
      .password-text { font-size: 13px !important; }
      .welcome-box { padding: 12px 14px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#e8ecf1;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#e8ecf1;padding:20px 0;">
    <tr>
      <td align="center" style="padding:0 12px;">

        <!-- Header Bar -->
        <table class="outer-table" width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;background-color:#ffffff;border-radius:12px 12px 0 0;border-bottom:1px solid #e5e7eb;">
          <tr>
            <td class="header-cell" style="padding:18px 32px;">
              <img src="cid:rhythmrx-icon" alt="RX" style="height:28px;vertical-align:middle;margin-right:10px;" />
              <span style="font-size:16px;font-weight:800;color:#1a202c;letter-spacing:1.5px;vertical-align:middle;">RHYTHMRX</span>
            </td>
          </tr>
        </table>                   
        <table class="outer-table" width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;background-color:#ffffff;">
          <tr>
            <td style="padding:0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <!-- Watermark Column (hidden on mobile) -->
                  <td class="watermark-col" width="60" style="vertical-align:top;background-color:#f0f3f7;padding:40px 0;text-align:center;">
                    <div style="writing-mode:vertical-lr;transform:rotate(180deg);font-size:36px;font-weight:900;color:#dde2ea;letter-spacing:4px;line-height:1;white-space:nowrap;">WELCOME TO THE TEAM</div>
                  </td>

                  <!-- Content Column -->
                  <td class="content-col" style="padding:40px 48px;vertical-align:top;">

                    <!-- Access Granted Badge -->
                    <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#a855f7;text-transform:uppercase;letter-spacing:2px;">Access Granted</p>

                    <!-- Greeting -->
                    <h1 class="greeting" style="margin:0 0 12px;color:#111827;font-size:32px;font-weight:800;line-height:1.2;">
                      Hello, ${fullName}.
                    </h1>
                    <p style="margin:0 0 16px;color:#6b7280;font-size:14px;line-height:1.7;">
                      Your environment has been provisioned. Below are your unique access parameters for the <strong style="color:#111827;">RhythmRx Technical Stack</strong>.
                    </p>

                    <!-- Welcome Message -->
                    <div class="welcome-box" style="background-color:#faf5ff;border-left:3px solid #a855f7;padding:14px 18px;border-radius:0 8px 8px 0;margin-bottom:32px;">
                      <p style="margin:0;color:#6b21a8;font-size:13px;line-height:1.7;">
                        We're excited to have you on board! You now have full access to the Effort Tracker platform. Use your credentials below to log in and start tracking your work seamlessly.
                      </p>
                    </div>

                    <!-- Credentials -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                      <!-- Email -->
                      <tr>
                        <td style="padding-bottom:24px;">
                          <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:1.5px;">Identity Endpoint</p>
                          <table cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="vertical-align:middle;padding-right:8px;">
                                <div style="width:28px;height:28px;border-radius:50%;background-color:#f3e8ff;text-align:center;line-height:28px;font-size:14px;color:#a855f7;">@</div>
                              </td>
                              <td style="vertical-align:middle;">
                                <span class="email-text" style="font-size:15px;font-weight:600;color:#111827;word-break:break-all;">${email}</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <!-- Password -->
                      <tr>
                        <td>
                          <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:1.5px;">Password</p>
                          <table cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="vertical-align:middle;padding-right:8px;">
                                <div style="width:28px;height:28px;border-radius:50%;background-color:#f3e8ff;text-align:center;line-height:28px;font-size:14px;color:#a855f7;">&#128279;</div>
                              </td>
                              <td style="vertical-align:middle;">
                                <span class="password-text" style="font-size:15px;font-weight:700;color:#111827;font-family:'Courier New',monospace;">${password}</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>

                    <!-- Login Link -->
                    <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.7;word-break:break-all;">
                      Login here: <a href="${loginUrl}" style="color:#a855f7;text-decoration:none;font-weight:700;">${loginUrl}</a>
                    </p>

                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table class="outer-table" width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;background-color:#ffffff;border-radius:0 0 12px 12px;border-top:1px solid #e5e7eb;">
          <tr>
            <td class="footer-cell" style="padding:18px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <span style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">&copy; ${year} RhythmRX Labs</span>
                  </td>
                  <td style="vertical-align:middle;text-align:right;">
                    <span style="font-size:10px;color:#c0c5ce;">v2.4.0-stable</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}
