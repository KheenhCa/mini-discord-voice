// public/client.js
const ROOM = 'lobby';
let socket = io(); // kết nối socket

let localStream = null;
let isMuted = false;
let pttHeld = false; // push-to-talk (giữ Space để nói)
const peers = new Map(); // peerId -> { pc, audioEl }

const $ = (id) => document.getElementById(id);

$('joinBtn').onclick = joinRoom;
$('leaveBtn').onclick = leaveRoom;
$('muteBtn').onclick = toggleMute;

// Push-to-talk: giữ phím Space để bật mic tạm thời
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !pttHeld) {
    pttHeld = true;
    setMicEnabled(true);
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    pttHeld = false;
    if (isMuted) setMicEnabled(false);
  }
});

async function joinRoom(){
  $('status').textContent = 'Yêu cầu quyền micro...';
  const displayName = $('displayName').value.trim() || '';
  try{
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    $('localAudio').srcObject = localStream; // monitor local (muted)

    // (re)connect socket nếu cần
    if (socket.disconnected) socket.connect();

    socket.emit('join', ROOM, displayName);
    $('status').textContent = 'Đã vào phòng. Đang kết nối các peer...';
    $('joinBtn').disabled = true;
    $('leaveBtn').disabled = false;
    $('muteBtn').disabled = false;
    $('meName').textContent = displayName ? `Bạn: ${displayName}` : '';
  } catch(err){
    console.error(err);
    $('status').textContent = 'Không truy cập được micro. Kiểm tra quyền trình duyệt.';
  }
}

function leaveRoom(){
  // Đóng toàn bộ peer connections
  for (const [id, p] of peers) {
    try{ p.pc.close(); } catch{}
    if (p.audioEl && p.audioEl.parentNode) p.audioEl.parentNode.removeChild(p.audioEl);
  }
  peers.clear();

  // Ngắt socket (có thể connect lại khi Join)
  socket.disconnect();

  $('status').textContent = 'Đã rời phòng';
  $('joinBtn').disabled = false;
  $('leaveBtn').disabled = true;
  $('muteBtn').disabled = true;
  $('peers').innerHTML = '';
}

function toggleMute(){
  isMuted = !isMuted;
  setMicEnabled(!isMuted);
  $('muteBtn').textContent = isMuted ? 'Bật mic' : 'Tắt mic';
}

function setMicEnabled(enabled){
  if (!localStream) return;
  localStream.getAudioTracks().forEach(t => t.enabled = enabled);
}

// Nhận danh sách peers hiện có khi mới vào
socket.on('peers', async (peerIds) => {
  $('peers').innerHTML = peerIds.map(id => `<span class="pill" id="peer-${id}">${id.slice(0,4)}</span>`).join('');
  for (const peerId of peerIds) {
    await createConnectionAndOffer(peerId);
  }
});

// Có người mới vào
socket.on('peer-joined', async (peerId, displayName) => {
  addPeerBadge(peerId, displayName);
});

// Ai đó rời phòng
socket.on('peer-left', (peerId) => {
  removePeer(peerId);
});

// Nhận tín hiệu WebRTC
socket.on('signal', async ({ from, type, data }) => {
  let peer = peers.get(from);
  if (!peer) {
    peer = await createPeer(from, false); // tạo khi nhận offer đầu tiên
  }

  if (type === 'offer') {
    await peer.pc.setRemoteDescription(new RTCSessionDescription(data));
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    socket.emit('signal', { to: from, type: 'answer', data: answer });
  } else if (type === 'answer') {
    await peer.pc.setRemoteDescription(new RTCSessionDescription(data));
  } else if (type === 'ice-candidate') {
    if (data) {
      try { await peer.pc.addIceCandidate(data); } catch (e) { console.warn(e); }
    }
  }
});

function addPeerBadge(id, name=''){
  const peersDiv = $('peers');
  const el = document.createElement('span');
  el.className = 'pill';
  el.id = `peer-${id}`;
  el.textContent = name ? `${name} (${id.slice(0,4)})` : id;
  peersDiv.appendChild(el);
}

function removePeer(id){
  const p = peers.get(id);
  if (p) {
    try{ p.pc.close(); } catch{}
    if (p.audioEl && p.audioEl.parentNode) p.audioEl.parentNode.removeChild(p.audioEl);
    peers.delete(id);
  }
  const badge = document.getElementById(`peer-${id}`);
  if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
}

async function createPeer(peerId, willInitiate){
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
      // Khuyến nghị khi triển khai Internet:
      // { urls: 'turn:your.turn.server:3478', username: 'user', credential: 'pass' }
    ]
  });

  // Gắn local audio track
  if (localStream) {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
  }

  // Gửi ICE cho peer đối tác
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('signal', { to: peerId, type: 'ice-candidate', data: e.candidate });
    }
  };

  // Nhận remote stream
  pc.ontrack = (e) => {
    let audioEl = document.getElementById(`audio-${peerId}`);
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.id = `audio-${peerId}`;
      audioEl.autoplay = true;
      document.getElementById('remoteAudios').appendChild(audioEl);
    }
    audioEl.srcObject = e.streams[0];
  };

  const obj = { pc, audioEl: null };
  peers.set(peerId, obj);

  if (willInitiate) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { to: peerId, type: 'offer', data: offer });
  }

  return obj;
}

async function createConnectionAndOffer(peerId){
  addPeerBadge(peerId);
  const p = await createPeer(peerId, true);
  return p;
}

// Đóng kết nối gọn gàng khi rời trang
window.addEventListener('beforeunload', () => {
  try { leaveRoom(); } catch {}
});
