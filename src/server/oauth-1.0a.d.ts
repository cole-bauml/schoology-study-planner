declare module "oauth-1.0a" {
  interface OAuthRequest {
    url: string;
    method: string;
  }

  interface OAuthOptions {
    consumer: { key: string; secret: string };
    signature_method: string;
    hash_function(baseString: string, key: string): string;
    nonce_length?: number;
  }

  class OAuth {
    constructor(options: OAuthOptions);
    authorize(request: OAuthRequest): Record<string, string>;
    toHeader(data: Record<string, string>): Record<string, string>;
    getNonce(): string;
    getTimeStamp(): number;
  }

  export default OAuth;
}
