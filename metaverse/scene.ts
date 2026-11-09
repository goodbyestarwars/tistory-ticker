import { BoxGeometry, CanvasTexture, SphereGeometry, Sprite, SpriteMaterial, Vector3, Color, Group, HemisphereLight, Mesh, MeshLambertMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

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
  scene.background = new Color(0x242c4b);
  scene.add(new HemisphereLight(0xffe4bb, 0x697494, 2.4), player);
  block(30,.2,30,0x294449,0,-.15,0);
  block(19,.2,19,0x827771,0,-.1,0);
  for (let i = -4; i <= 4; i++) {
    block(18,.01,.035,0x494956,0,.008,i*2);
    block(.035,.01,18,0x494956,i*2,.008,0);
  }
  for (const side of [-1,1]) {
    for (const z of [-7,-3,2]) {
      const x = side*6.6;
      block(2.4,.42,1.5,0x4c5062,x,.21,z);
      block(.19,2,.19,0x67584e,x,1,z);
      const canopy = new Mesh(new SphereGeometry(.95,9,6),new MeshLambertMaterial({color:0x40786d}));
      canopy.position.set(x,2.25,z);
      canopy.scale.set(1,1.18,.85);
      scene.add(canopy);
      block(.12,2.8,.12,0x33324a,side*4.4,1.4,z);
      block(.35,.38,.35,0xffc076,side*4.4,2.8,z);
    }
  }
  block(7,2.8,.45,0x35455e,0,1.4,-8.8);
  block(8,.22,1.4,0x52475b,0,2.88,-8.8);
  const sign = document.createElement('canvas');
  sign.width = 512;
  sign.height = 96;
  const ink = sign.getContext('2d')!;
  ink.fillStyle = '#253147';
  ink.fillRect(0,0,512,96);
  ink.fillStyle = '#ffe3ae';
  ink.font = 'bold 48px sans-serif';
  ink.textAlign = 'center';
  ink.fillText('gOOdbyestar',256,63);
  const texture = new CanvasTexture(sign);
  const signMaterial = new SpriteMaterial({map:texture});
  const label = new Sprite(signMaterial);
  label.scale.set(5.5,1.03,1);
  label.position.set(0,1.95,-8.45);
  scene.add(label);
  for (const side of [-1,1]) {
    player.add(block(.19,.57,.23,0x303846,side*.13,.34,0));
    player.add(block(.16,.5,.19,0xeab585,side*.36,.94,0));
  }
  player.add(block(.54,.62,.32,0x496d9d,0,.98,0));
  const head = new Mesh(new SphereGeometry(.23,12,8),new MeshLambertMaterial({color:0xeab585}));
  head.position.y = 1.54;
  player.add(head);
  player.add(block(.38,.14,.33,0x42333c,0,1.7,0));
  const authors = Array.from({length:10}, (_,index) => {
    const figure = player.clone();
    figure.position.set((index%5-2)*1.65,0,-3.2-Math.floor(index/5)*2.3);
    figure.visible = false;
    scene.add(figure);
    return figure;
  });
  player.visible = false;
  let labels: HTMLElement[] = [];
  function refreshAuthors() {
    labels = [...stage.querySelectorAll<HTMLElement>('.square-bubble')];
    authors.forEach((figure,index) => { figure.visible = index < labels.length; });
    dirty = true;
  }

  const anchor = new Vector3();
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
    camera.updateMatrixWorld();
    labels.forEach((label,index) => {
      anchor.copy(authors[index].position);
      anchor.y = 2.05;
      anchor.project(camera);
      label.hidden = anchor.z < -1 || anchor.z > 1 || Math.abs(anchor.x) > .94 || Math.abs(anchor.y) > .9;
      label.style.left = (anchor.x*.5+.5)*100+'%';
      label.style.top = (.5-anchor.y*.5)*100+'%';
    });
    renderer.render(scene,camera);
  }
  function visibility() {
    cancelAnimationFrame(frame);
    keys.clear();
    touch.clear();
    if (!document.hidden) frame = requestAnimationFrame(tick);
  }
  document.addEventListener('visibilitychange',visibility,options);
  stage.addEventListener('square-authors',refreshAuthors,options);
  refreshAuthors();
  visibility();
  signal.addEventListener('abort', () => {
    cancelAnimationFrame(frame);
    resize.disconnect();
    scene.traverse(obj => {
      if (obj instanceof Mesh && !authors.includes(obj.parent as Group)) { obj.geometry.dispose(); obj.material.dispose(); }
    });
    texture.dispose();
    signMaterial.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  },{once:true});
  canvas.addEventListener('webglcontextlost', () => stage.dispatchEvent(new Event('square-context-lost')),options);
}
