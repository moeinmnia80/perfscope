import { useEffect } from "react";
import { init, type PerfscopeOptions } from "./index";

/** `<Perfscope />` anywhere in your tree (a client component). Development only. */
export function Perfscope(props: PerfscopeOptions = {}) {
  useEffect(() => {
    const handle = init(props);
    void handle;
    // intentionally not destroyed on unmount: the overlay belongs to the page, not to a component
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export { init };
export type { PerfscopeOptions };
