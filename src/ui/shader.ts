/**
 * A tiny WebGL fragment shader for the panel header: slow contour lines in the accent color.
 * Cost control: it draws only while the panel is open AND the tab is visible, at half resolution,
 * capped at 30 fps; intensity 0 (or reduced motion) draws nothing / a single frame; context loss is survived.
 */
const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `
precision mediump float;
uniform vec2 uRes; uniform float uTime; uniform vec3 uColor; uniform float uAmount;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for(int i=0;i<4;i++){ v += a*n(p); p = p*2.02 + 7.3; a *= 0.5; } return v; }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 q = vec2(uv.x * uRes.x / uRes.y * 2.2, uv.y * 2.2);
  float t = uTime * 0.05;
  float f = fbm(q + vec2(t, -t * 0.6) + fbm(q * 1.3 - t));
  float lines = abs(fract(f * 7.0) - 0.5);
  float line = smoothstep(0.06, 0.0, lines);
  float fade = smoothstep(1.0, 0.1, uv.y) * 0.9 + 0.1;
  float a = (line * 0.55 + f * 0.18) * fade * uAmount;
  gl_FragColor = vec4(uColor * a, a);
}`;

export class Shader {
  private gl: WebGLRenderingContext | null = null;
  private prog?: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private raf = 0;
  private last = 0;
  private running = false;
  private color: [number, number, number] = [1, 0.36, 0.34];
  amount = 0.55;
  private t0 = performance.now();

  constructor(private canvas: HTMLCanvasElement) {
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.gl = null; cancelAnimationFrame(this.raf); this.raf = 0; });
    canvas.addEventListener("webglcontextrestored", () => { this.init(); if (this.running) this.kick(); });
  }

  private init(): boolean {
    const gl = (this.canvas.getContext("webgl", { alpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power", premultipliedAlpha: true }) as WebGLRenderingContext | null);
    if (!gl) return false;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ["uRes", "uTime", "uColor", "uAmount"]) this.u[n] = gl.getUniformLocation(prog, n);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.gl = gl;
    this.prog = prog;
    return true;
  }

  setColor(hex: string) {
    const n = parseInt(hex.slice(1), 16);
    this.color = [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  private size() {
    const w = Math.max(1, Math.round(this.canvas.clientWidth * 0.5));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * 0.5));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  private draw = (now: number) => {
    this.raf = 0;
    if (!this.running || !this.gl || document.hidden || this.amount <= 0) return;
    if (now - this.last >= 33) {
      this.last = now;
      this.size();
      const gl = this.gl;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(this.u.uRes!, this.canvas.width, this.canvas.height);
      gl.uniform1f(this.u.uTime!, (now - this.t0) / 1000);
      gl.uniform3f(this.u.uColor!, ...this.color);
      gl.uniform1f(this.u.uAmount!, this.amount);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) this.raf = requestAnimationFrame(this.draw);
  };

  private kick() {
    if (!this.raf) this.raf = requestAnimationFrame(this.draw);
  }

  /** start drawing (idempotent) */
  start() {
    this.running = true;
    this.canvas.style.display = this.amount > 0 ? "block" : "none";
    if (this.amount <= 0) return;
    if (!this.gl && !this.init()) { this.canvas.style.display = "none"; return; }
    this.last = 0;
    this.kick();
  }

  /** stop drawing and free the frame loop (the context itself is kept for a fast re-open) */
  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  destroy() {
    this.stop();
    this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
  }
}
