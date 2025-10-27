declare module 'scrypt-ord/dist/ordiProvider.js' {
  import { Provider } from 'scrypt-ts';
  import { bsv } from 'scrypt-ts';

  export class OrdiProvider extends Provider {
    constructor(network: bsv.Networks.Network);
  }
}
