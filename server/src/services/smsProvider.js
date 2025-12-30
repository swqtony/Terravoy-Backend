export class SmsProviderNotConfigured extends Error {
  constructor(message = 'SMS provider not configured') {
    super(message);
    this.name = 'SmsProviderNotConfigured';
    this.code = 'SMS_PROVIDER_NOT_CONFIGURED';
  }
}

export async function sendSmsViaProvider({
  phone,
  code,
  purpose,
  provider,
  providerKey,
  providerSecret,
  providerSign,
  providerTemplateLogin,
  providerTemplateRegister,
}) {
  if (!provider) {
    throw new SmsProviderNotConfigured('SMS provider not configured');
  }

  // Placeholder: no real gateway implementation yet.
  void phone;
  void code;
  void purpose;
  void providerKey;
  void providerSecret;
  void providerSign;
  void providerTemplateLogin;
  void providerTemplateRegister;

  throw new SmsProviderNotConfigured(
    `SMS provider "${provider}" not implemented`
  );
}
