// import "@moeinmnia/perfscope/auto": starts perfscope as early as possible (before React loads,
// so component timings are live). Development only; a no-op on the server and in production.
import { init } from "./index";

init();
