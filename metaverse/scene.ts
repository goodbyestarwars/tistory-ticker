import { BoxGeometry, CapsuleGeometry, Color, Group, HemisphereLight, Mesh, MeshLambertMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

export function start(stage: HTMLElement, signal: AbortSignal) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(48, 1, .1, 60);
  const renderer = new WebGLRenderer({ antialias: false });
  const mobile = matchMedia('(pointer: coarse)');
  const player = new Group();
  function block(w: number, h: number, d: number, color: number, x: number, y: number, z: number) {
    const mesh = new Mesh(new BoxGeometry(w,h,d), new MeshLambertMaterial({color}));
    mesh.position.set(x,y,z);
    scene.add(mesh);
    return mesh;
  }
  scene.background = new Color(0xe5edf4);
  scene.add(new HemisphereLight(0xffffff, 0x596478, 2), player);
  block(20,.2,20,0xc1cdd3,0,-.1,0);
  for (const side of [-1,1]) {
    block(20,.5,.25,0x647787,0,.25,side*10);
    block(.25,.5,20,0x647787,side*10,.25,0);
  }
  block(4,2.3,.3,0x344e65,0,1.15,-8);
  const avatar = new Mesh(new CapsuleGeometry(.35,.65,4,8), new MeshLambertMaterial({color:0x255f9b}));
  avatar.position.y = .69;
  player.add(avatar);
  player.add(block(.34,.12,.12,0xe5edf4,0,.98,.33));
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label','3D 광장. 방향키 또는 WASD로 이동');
  stage.prepend(canvas);
  const keys = new Set<string>();
  const moves: Record<string,string> = {w:'up',a:'left',s:'down',d:'right',arrowup:'up',arrowleft:'left',arrowdown:'down',arrowright:'right'};
  let angle = 0, distance = 7, frame = 0, last = 0, drag = -1, pointerX = 0, dirty = true;
  const options = {signal};
  canvas.addEventListener('keydown', e => {
    const move = moves[e.key.toLowerCase()];
    if (move) { e.preventDefault(); keys.add(e.code); }
  }, options);
  window.addEventListener('keyup', e => keys.delete(e.code), options);
  canvas.addEventListener('blur', () => keys.clear(), options);
  window.addEventListener('blur', () => keys.clear(), options);
  canvas.addEventListener('pointerdown', e => {
    canvas.focus({preventScroll:true});
    drag = e.pointerId;
    pointerX = e.clientX;
    canvas.setPointerCapture(drag);
  }, options);
  canvas.addEventListener('pointermove', e => {
    if (e.pointerId === drag) { angle -= (e.clientX - pointerX) * .009; pointerX = e.clientX; dirty = true; }
  }, options);
  canvas.addEventListener('lostpointercapture', () => { drag = -1; }, options);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    distance = Math.min(12, Math.max(3, distance + Math.sign(e.deltaY) * .5));
    dirty = true;
  }, {signal,passive:false});
  const touch = new Map<number,string>();
  for (const button of stage.querySelectorAll<HTMLButtonElement>('[data-move]')) {
    button.addEventListener('pointerdown', e => {
      button.setPointerCapture(e.pointerId);
      touch.set(e.pointerId, button.dataset.move!);
    }, options);
    button.addEventListener('lostpointercapture', e => touch.delete(e.pointerId), options);
  }
  const resize = new ResizeObserver(() => {
    const width = stage.clientWidth, height = stage.clientHeight;
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio, mobile.matches ? 1 : 1.5));
    renderer.setSize(width,height,false);
    camera.aspect = width/height;
    camera.updateProjectionMatrix();
    dirty = true;
  });
  resize.observe(stage);
  function tick(now: number) {
    frame = requestAnimationFrame(tick);
    const interval = 1000/(mobile.matches ? 24 : 30);
    if (now-last < interval) return;
    const dt = Math.min((now-last)/1000,.06);
    last = now;
    const direction = new Set(touch.values());
    for (const code of keys) direction.add(moves[code.replace(/^Key/,'').toLowerCase()]);
    const x = Number(direction.has('right'))-Number(direction.has('left'));
    const z = Number(direction.has('down'))-Number(direction.has('up'));
    if (x || z) {
      const dx = x*Math.cos(angle)+z*Math.sin(angle);
      const dz = z*Math.cos(angle)-x*Math.sin(angle);
      const speed = 4*dt/Math.hypot(x,z);
      player.position.x = Math.max(-9.4,Math.min(9.4,player.position.x+dx*speed));
      player.position.z = Math.max(-9.4,Math.min(9.4,player.position.z+dz*speed));
      player.rotation.y = Math.atan2(dx,dz);
      dirty = true;
    }
    if (!dirty) return;
    dirty = false;
    camera.position.set(player.position.x+distance*Math.sin(angle),distance*.61,player.position.z+distance*Math.cos(angle));
    camera.lookAt(player.position.x,.8,player.position.z);
    renderer.render(scene,camera);
  }
  function visibility() {
    cancelAnimationFrame(frame);
    keys.clear();
    touch.clear();
    if (!document.hidden) frame = requestAnimationFrame(tick);
  }
  document.addEventListener('visibilitychange',visibility,options);
  visibility();
  signal.addEventListener('abort', () => {
    cancelAnimationFrame(frame);
    resize.disconnect();
    scene.traverse(obj => {
      if (obj instanceof Mesh) { obj.geometry.dispose(); obj.material.dispose(); }
    });
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  },{once:true});
  canvas.addEventListener('webglcontextlost', () => stage.dispatchEvent(new Event('square-context-lost')),options);
}
