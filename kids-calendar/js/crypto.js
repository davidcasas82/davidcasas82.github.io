/**
 * Password-based encryption for the GitHub token.
 * Admin runs setup once; family only ever types the shared password.
 */
(function (global) {
  'use strict';

  const PBKDF2_ITERATIONS = 250000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function bufToB64(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function b64ToBuf(b64) {
    const s = atob(b64);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes.buffer;
  }

  async function deriveKey(password, saltBuf) {
    const baseKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBuf,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * @param {string} password
   * @param {string} plaintext token
   * @returns {Promise<{salt:string, iv:string, ciphertext:string, iterations:number}>}
   */
  async function encryptToken(password, plaintext) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const cipherBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(plaintext)
    );
    return {
      salt: bufToB64(salt),
      iv: bufToB64(iv),
      ciphertext: bufToB64(cipherBuf),
      iterations: PBKDF2_ITERATIONS,
    };
  }

  /**
   * @param {string} password
   * @param {{salt:string, iv:string, ciphertext:string}} cryptoBlock
   * @returns {Promise<string>} plaintext token
   */
  async function decryptToken(password, cryptoBlock) {
    if (!cryptoBlock || !cryptoBlock.salt || !cryptoBlock.iv || !cryptoBlock.ciphertext) {
      throw new Error('Missing encrypted credentials');
    }
    const salt = b64ToBuf(cryptoBlock.salt);
    const iv = new Uint8Array(b64ToBuf(cryptoBlock.iv));
    const key = await deriveKey(password, salt);
    try {
      const plainBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        b64ToBuf(cryptoBlock.ciphertext)
      );
      return decoder.decode(plainBuf);
    } catch {
      throw new Error('Wrong password');
    }
  }

  function isConfigured(config) {
    return Boolean(
      config &&
      config.owner &&
      config.repo &&
      config.crypto &&
      config.crypto.ciphertext
    );
  }

  /** Kids view uses a separate encrypted blob so the family password cannot unwrap it. */
  function isKidsConfigured(config) {
    return Boolean(
      config &&
      config.owner &&
      config.repo &&
      config.kidsCrypto &&
      config.kidsCrypto.ciphertext
    );
  }

  global.CustodyCrypto = {
    encryptToken,
    decryptToken,
    isConfigured,
    isKidsConfigured,
    PBKDF2_ITERATIONS,
  };
})(window);
