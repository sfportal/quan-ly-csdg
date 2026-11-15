/// <reference types="astro/client" />
declare namespace App {
  interface Locals {
    user: null | { id: string; email: string; name: string; is_sysadmin: number };
    tenant: null | any;
    role: string | null;
    sid: string | null;
    can: (perm: string) => boolean;
  }
}
declare module 'cloudflare:workers' { export const env: any; }
