declare module 'scrypt-ord' {
  import { Provider, bsv } from 'scrypt-ts';

  export class OrdiProvider extends Provider {
    constructor(network?: bsv.Networks.Network);
  }
}
