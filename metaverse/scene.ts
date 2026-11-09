import { BoxGeometry, Fog, TorusGeometry, MeshBasicMaterial, DirectionalLight, CanvasTexture, SphereGeometry, Sprite, SpriteMaterial, Vector3, Color, Group, HemisphereLight, Mesh, MeshLambertMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

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
  scene.background = new Color(0x191842);
  scene.fog = new Fog(0x191842, 18, 48);
  scene.add(new HemisphereLight(0xe1f5ff, 0x6052ac, 2.2), player);
  const keyLight = new DirectionalLight(0xffc4eb, 2);
  keyLight.position.set(-5,8,3);
  scene.add(keyLight);
  const cyan = new MeshBasicMaterial({color:0x71f9ff});
  const violet = new MeshBasicMaterial({color:0xb99bff});
  function strip(w: number, h: number, d: number, x: number, y: number, z: number, material = cyan) {
    const mesh = new Mesh(new BoxGeometry(w,h,d),material);
    mesh.position.set(x,y,z);
    scene.add(mesh);
  }
  block(38,.2,38,0x101b3c,0,-.26,0);
  block(19,.35,19,0x2d3c60,0,-.18,0);
  for (const side of [-1,1]) {
    strip(.06,.025,18,side*8.8,.015,0);
    strip(.045,.025,16,side*3.8,.015,-.6,violet);
    for (const z of [-6,-1,4]) {
      const x = side*6.5;
      block(2.1,.45,1.7,0x4c5284,x,.22,z);
      strip(2.2,.05,1.78,x,.45,z,violet);
      block(.16,1.7,.16,0x785c8b,x,1.25,z);
      const canopy = new Mesh(new SphereGeometry(.8,8,5),new MeshLambertMaterial({color:side>0?0x9b77e6:0x47bbd3,flatShading:true}));
      canopy.position.set(x,2.14,z);
      scene.add(canopy);
    }
  }
  for (let i=0;i<17;i++) {
    const x = (i-8)*2.8;
    const height = 3.4+(i*7%13)*.55;
    const z = -17-(i%3)*2;
    block(2.1,height,2.3,i%2?0x303968:0x3c3673,x,height*.5,z);
    for (let y=1;y<height-.2;y+=.9) {
      strip(1.45,.1,.03,x,y,z+1.17,i%3?violet:cyan);
    }
  }
  block(8,.55,2.8,0x343e67,0,.27,-8.1);
  strip(8,.07,.06,0,.5,-6.68);
  block(7.4,3.4,.46,0x20294b,0,2.25,-8.7);
  for (const side of [-1,1]) {
    strip(.08,3.45,.08,side*3.7,2.25,-8.42);
    const ring = new Mesh(new TorusGeometry(.78,.045,8,32),side>0?violet:cyan);
    ring.position.set(side*4.9,1.65,-8.2);
    scene.add(ring);
  }
  strip(7.4,.07,.08,0,3.98,-8.42,violet);
  const sign = document.createElement('canvas');
  sign.width = 512;
  sign.height = 96;
  const ink = sign.getContext('2d')!;
  ink.fillStyle = '#20294b';
  ink.fillRect(0,0,512,96);
  ink.fillStyle = '#a9f7ff';
  ink.font = 'bold 48px sans-serif';
  ink.textAlign = 'center';
  ink.fillText('gOOdbyestar',256,63);
  const texture = new CanvasTexture(sign);
  const signMaterial = new SpriteMaterial({map:texture});
  const label = new Sprite(signMaterial);
  label.scale.set(5.5,1.03,1);
  label.position.set(0,2.45,-8.42);
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
  const outfits = [0x76d4ed,0xbf99ff,0xf09bc1,0xf9c681,0x8ae0c4];
  const authors = Array.from({length:10}, (_,index) => {
    const figure = player.clone();
    const jacket = figure.children[4] as Mesh<BoxGeometry, MeshLambertMaterial>;
    jacket.material = new MeshLambertMaterial({color:outfits[index%outfits.length]});
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
    authors.forEach(figure => (figure.children[4] as Mesh<BoxGeometry, MeshLambertMaterial>).material.dispose());
    texture.dispose();
    signMaterial.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  },{once:true});
  canvas.addEventListener('webglcontextlost', () => stage.dispatchEvent(new Event('square-context-lost')),options);
}
