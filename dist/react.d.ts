import { PerfscopeOptions } from './index.js';
export { default as init } from './index.js';

/** `<Perfscope />` anywhere in your tree (a client component). Development only. */
declare function Perfscope(props?: PerfscopeOptions): null;

export { Perfscope, PerfscopeOptions };
