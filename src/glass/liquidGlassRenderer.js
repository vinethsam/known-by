/*
 * Adapted from dashersw/liquid-glass-js (MIT, © 2025 Armagan Amcalar).
 * See THIRD_PARTY_NOTICES.md. The shape mask, edge/rim refraction, and
 * sampled background blur follow that project's WebGL rendering approach.
 */

const vertexSource = `
  attribute vec2 a_position;
  attribute vec2 a_texcoord;
  varying vec2 v_texcoord;

  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texcoord = a_texcoord;
  }
`;

const fragmentSource = `
  precision mediump float;

  uniform sampler2D u_image;
  uniform vec2 u_size;
  uniform vec2 u_hostOrigin;
  uniform vec2 u_textureOrigin;
  uniform vec2 u_textureSize;
  uniform float u_borderRadius;
  uniform float u_blurRadius;
  uniform float u_edgeIntensity;
  uniform float u_rimIntensity;
  uniform float u_tintOpacity;
  uniform float u_surfaceOpacity;
  uniform vec3 u_tintColor;
  uniform vec3 u_accentColor;
  varying vec2 v_texcoord;

  float roundedRectDistance(vec2 coord, vec2 size, float radius) {
    vec2 center = size * 0.5;
    vec2 pixelCoord = coord * size;
    vec2 toCorner = abs(pixelCoord - center) - (center - radius);
    float outsideCorner = length(max(toCorner, 0.0));
    float insideCorner = min(max(toCorner.x, toCorner.y), 0.0);
    return outsideCorner + insideCorner - radius;
  }

  void main() {
    vec2 coord = v_texcoord;
    float shapeDistance = roundedRectDistance(coord, u_size, u_borderRadius);
    float insideDistance = max(-shapeDistance, 0.0);
    vec2 fromCenter = coord - vec2(0.5);
    vec2 shapeNormal = length(fromCenter) > 0.0001
      ? normalize(fromCenter) : vec2(0.0, 1.0);

    // The original library combines a tight edge falloff with a wider rim.
    float edge = exp(-insideDistance * 0.15);
    float rim = exp(-insideDistance * 0.8);
    float refraction = edge * u_edgeIntensity + rim * u_rimIntensity;
    vec2 pagePixel = u_hostOrigin + coord * u_size;
    vec2 samplePixel = pagePixel + shapeNormal * refraction * min(u_size.x, u_size.y) * 0.3;
    vec2 textureCoord = (samplePixel - u_textureOrigin) / u_textureSize;

    // Compact Gaussian blur: 25 taps rather than the original broad kernel.
    vec4 color = vec4(0.0);
    float totalWeight = 0.0;
    for (int x = -2; x <= 2; x++) {
      for (int y = -2; y <= 2; y++) {
        vec2 offset = vec2(float(x), float(y));
        float weight = exp(-dot(offset, offset) / 2.0);
        vec2 uv = textureCoord + offset * u_blurRadius / u_textureSize;
        color += texture2D(u_image, clamp(uv, vec2(0.0), vec2(1.0))) * weight;
        totalWeight += weight;
      }
    }
    color /= totalWeight;
    color.rgb = mix(color.rgb, u_tintColor, u_tintOpacity);
    color.rgb = mix(color.rgb, u_accentColor, rim * 0.035);

    float mask = 1.0 - smoothstep(-1.0, 1.0, shapeDistance);
    // Let live backgrounds (including animated gradients) remain visible.
    gl_FragColor = vec4(color.rgb, mask * u_surfaceOpacity);
  }
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

function createProgram(gl) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }
  return { program, vertexShader, fragmentShader };
}

export function createLiquidGlassRenderer(canvas) {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "low-power",
  });
  if (!gl) return null;

  const shaders = createProgram(gl);
  if (!shaders) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  }
  const { program, vertexShader, fragmentShader } = shaders;
  const buffer = gl.createBuffer();
  const texture = gl.createTexture();
  if (!buffer || !texture) {
    if (buffer) gl.deleteBuffer(buffer);
    if (texture) gl.deleteTexture(texture);
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  }

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0,
      -1, 1, 0, 0, 1, -1, 1, 1, 1, 1, 1, 0,
    ]),
    gl.STATIC_DRAW,
  );
  const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
  const position = gl.getAttribLocation(program, "a_position");
  const texcoord = gl.getAttribLocation(program, "a_texcoord");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(texcoord);
  gl.vertexAttribPointer(texcoord, 2, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);

  const uniforms = Object.fromEntries(
    [
      "u_image", "u_size", "u_hostOrigin", "u_textureOrigin", "u_textureSize",
      "u_borderRadius", "u_blurRadius", "u_edgeIntensity", "u_rimIntensity",
      "u_tintOpacity", "u_surfaceOpacity", "u_tintColor", "u_accentColor",
    ].map((name) => [name, gl.getUniformLocation(program, name)]),
  );
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(uniforms.u_image, 0);

  const crop = document.createElement("canvas");
  const cropContext = crop.getContext("2d", { willReadFrequently: false });
  if (!cropContext) {
    gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  }

  let snapshot = null;
  let previousCropKey = "";
  let destroyed = false;
  const viewportLimits = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  const maxCanvasDimension = Math.min(
    4096,
    gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    viewportLimits[0],
    viewportLimits[1],
  );
  const maxCanvasPixels = 4_000_000;

  function draw(host, options) {
    if (destroyed || !snapshot) return false;
    const rect = host.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.ceil(rect.width * dpr));
    const height = Math.max(1, Math.ceil(rect.height * dpr));
    if (width > maxCanvasDimension || height > maxCanvasDimension || width * height > maxCanvasPixels) {
      canvas.style.display = "none";
      return false;
    }
    canvas.style.display = "";
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);

    const scale = snapshot.scale;
    const pageX = snapshot.fixed ? rect.left : rect.left + window.scrollX;
    const pageY = snapshot.fixed ? rect.top : rect.top + window.scrollY;
    const padding = Math.max(20, options.blurRadius * 8);
    const x = Math.max(0, Math.floor((pageX - padding) * scale));
    const y = Math.max(0, Math.floor((pageY - padding) * scale));
    const right = Math.min(snapshot.canvas.width, Math.ceil((pageX + rect.width + padding) * scale));
    const bottom = Math.min(snapshot.canvas.height, Math.ceil((pageY + rect.height + padding) * scale));
    const cropWidth = right - x;
    const cropHeight = bottom - y;
    if (cropWidth < 1 || cropHeight < 1) return false;

    const cropKey = `${snapshot.version}:${x}:${y}:${cropWidth}:${cropHeight}`;
    if (cropKey !== previousCropKey) {
      crop.width = cropWidth;
      crop.height = cropHeight;
      cropContext.drawImage(snapshot.canvas, x, y, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, crop);
      previousCropKey = cropKey;
    }

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform2f(uniforms.u_size, rect.width, rect.height);
    gl.uniform2f(uniforms.u_hostOrigin, pageX, pageY);
    gl.uniform2f(uniforms.u_textureOrigin, x / scale, y / scale);
    gl.uniform2f(uniforms.u_textureSize, cropWidth / scale, cropHeight / scale);
    gl.uniform1f(uniforms.u_borderRadius, Math.min(options.borderRadius, rect.width / 2, rect.height / 2));
    gl.uniform1f(uniforms.u_blurRadius, options.blurRadius);
    gl.uniform1f(uniforms.u_edgeIntensity, options.edgeIntensity);
    gl.uniform1f(uniforms.u_rimIntensity, options.rimIntensity);
    gl.uniform1f(uniforms.u_tintOpacity, options.tintOpacity);
    gl.uniform1f(uniforms.u_surfaceOpacity, options.surfaceOpacity);
    gl.uniform3fv(uniforms.u_tintColor, options.tintColor);
    gl.uniform3fv(uniforms.u_accentColor, options.accentColor);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return true;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    snapshot = null;
    crop.width = 0;
    crop.height = 0;
    gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  return {
    setSnapshot(nextSnapshot) {
      snapshot = nextSnapshot;
      previousCropKey = "";
    },
    draw,
    destroy,
  };
}
