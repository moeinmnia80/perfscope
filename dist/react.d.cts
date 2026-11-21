import { PerfscopeOptions } from './index.cjs';
export { default as init } from './index.cjs';

/** `<Perfscope />` anywhere in your tree (a client component). Development only. */
declare function Perfscope(props?: PerfscopeOptions): null;

export { Perfscope, PerfscopeOptions };
