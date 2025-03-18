// Face-Avoiding Security Camera using ML5 FaceMesh
// State-based approach: detect face → move away → repeat
// If no face s detected after 200 frames, we enter scanning mode where we look back and forth.

let video;
let faceMesh;
let faces = [];
let serial; // Serial object for Arduino communication
let serialConnected = false;

// Camera states
const STATE = {
  SEARCHING: 'searching', // Looking for faces
  AVOIDING: 'avoiding',   // Moving to avoid a detected face
  SCANNING: 'scanning'    // Horizontal scanning when idle
};
let currentState = STATE.SEARCHING;

// Servo control variables
let horizontalAngle = 90; // Start at center position (range: 30-180)
let verticalAngle = 30;   // Start slightly elevated (range: 0-45)

// Target angles for avoidance
let targetHorizontalAngle = 90;
let targetVerticalAngle = 30;

const POSITION_HOLD_TIME = 1000; // Hold position for 1 second (1000ms) after reaching target
let targetReachedTime = 0; // Tracks when the target position was reached


let noFaceFrameCount = 0;
const NO_FACE_TIMEOUT = 200; // Frames before switching to scanning
let scanStartTime = 0;
const SCAN_SPEED = 0.0005; // Controls scanning speed - lower is slower


// Movement parameters
const SMOOTHING = 0.9;        // Movement smoothing (higher = faster)
const HORIZONTAL_MIN = 50;    // Leftmost angle
const HORIZONTAL_MAX = 130;   // Rightmost angle
const VERTICAL_MIN = 0;       // Lowest angle (looking down)
const VERTICAL_MAX = 35;      // Highest angle (looking up)
const RANDOM_MOVE_CHANCE = 0; // % chance to move randomly when idle
const TARGET_REACHED_THRESHOLD = 2; // How close to target before considered reached

// Serial communication parameters
const SERIAL_RETRY_INTERVAL = 5000; // Time between reconnection attempts (ms)
let lastSerialSendTime = 0;
const SERIAL_SEND_INTERVAL = 50; // Send commands every 50ms to avoid flooding

function preload() {
  // Load FaceMesh model
  faceMesh = ml5.faceMesh({ maxFaces: 1, flipped: true });
}

function setup() {
  createCanvas(640, 480);
  video = createCapture(VIDEO);
  video.size(width, height);
  video.hide();

  // Start detecting faces
  faceMesh.detectStart(video, gotFaces);
  
  // Initialize serial connection
  initializeSerial();
}

function initializeSerial() {
  serial = new p5.SerialPort();
  
  // Set up serial event handlers
  serial.on('list', gotList);
  serial.on('connected', serverConnected);
  serial.on('open', portOpen);
  serial.on('error', serialError);
  serial.on('close', portClose);
  serial.on('data', serialEvent);
  
  // List all available ports
  serial.list();
}

function serverConnected() {
  console.log('Connected to Serial Server');
}

function portOpen() {
  console.log('Serial Port Opened');
  serialConnected = true;
  
  // Send initial positions to Arduino
  sendPositionsToArduino(horizontalAngle, verticalAngle);
}

function serialError(err) {
  console.log('Serial Port Error: ' + err);
  serialConnected = false;
  
  // Try to reconnect after a delay
  setTimeout(initializeSerial, SERIAL_RETRY_INTERVAL);
}

function portClose() {
  console.log('Serial Port Closed');
  serialConnected = false;
}

function serialEvent() {
  // Handle any incoming data from Arduino (if needed)
}

function gotList(thelist) {
  console.log('Available Serial Ports:');
  for (let i = 0; i < thelist.length; i++) {
    console.log(i + ': ' + thelist[i]);
  }
  
  // Try to open the first port
  if (thelist.length > 0) {
    // Look for Arduino-related names in port list
    let arduinoPort = -1;
    for (let i = 0; i < thelist.length; i++) {
      if (thelist[i].toLowerCase().includes('arduino') || 
          thelist[i].toLowerCase().includes('usbmodem') ||
          (thelist[i].toLowerCase().includes('com') && 
          !thelist[i].toLowerCase().includes('bluetooth'))) { // added for mac use
        arduinoPort = i;
        break;
      }
    }
    
    if (arduinoPort === -1) arduinoPort = 0; // Default to first port if no Arduino found
    serial.open(thelist[arduinoPort]);
    console.log("Opening port: " + thelist[arduinoPort]);
  } else {
    console.log("No serial ports found. Will retry...");
    setTimeout(initializeSerial, SERIAL_RETRY_INTERVAL);
  }
}

function gotFaces(results) {
  // Process face detection in SEARCHING or SCANNING states
  if (currentState === STATE.SEARCHING || currentState === STATE.SCANNING) {
    faces = results;
    
    // If face detected, calculate avoidance position and switch to AVOIDING state
    if (faces.length > 0) {
      let face = faces[0];
      let bbox = face.box;
      
      // Calculate face center
      const faceX = bbox.x + bbox.width / 2;
      const faceY = bbox.y + bbox.height / 2;
      
      // Calculate avoidance position
      calculateAvoidancePosition(faceX, faceY, bbox.width * bbox.height);
      
      // Switch to AVOIDING state
      currentState = STATE.AVOIDING;
      
      // Reset counter
      noFaceFrameCount = 0;
    }
  }
}

function sendPositionsToArduino(hPos, vPos) {
  // Only send if connected and not sending too frequently
  if (serialConnected && millis() - lastSerialSendTime > SERIAL_SEND_INTERVAL) {
    // Use format: "H[angle]V[angle]"
    let command = "H" + Math.floor(hPos) + "V" + Math.floor(vPos) + "\n";
    serial.write(command);
    lastSerialSendTime = millis();
  }
}

async function draw() {
  background(0);
  
  // Display the video with proper mirroring
  push();
  translate(width, 0);
  scale(-1, 1);
  image(video, 0, 0, width, height);
  pop();
  
  // State machine logic
  switch (currentState) {
    case STATE.SEARCHING:
      // In searching state, we're actively looking for faces
      if (faces.length === 0) {
        noFaceFrameCount++;
        
        // Switch to scanning mode after timeout
        if (noFaceFrameCount >= NO_FACE_TIMEOUT) {
          scanStartTime = millis();
          currentState = STATE.SCANNING;
          console.log("No faces detected for a while - switching to scanning mode");
        }
        
        // Random movement (if enabled)
        if (random(100) < RANDOM_MOVE_CHANCE) {
          targetHorizontalAngle = random(HORIZONTAL_MIN, HORIZONTAL_MAX);
          targetVerticalAngle = random(VERTICAL_MIN, VERTICAL_MAX);
          currentState = STATE.AVOIDING; // Switch to avoiding state for the random movement
        }
      } else {
        // Reset counter when face is detected
        noFaceFrameCount = 0;
      }
      break;
      
    case STATE.AVOIDING:
        // In avoiding state, move toward target position
        // Don't process new face detections until we reach the target
        
        // Move smoothly toward target
        horizontalAngle = lerp(horizontalAngle, targetHorizontalAngle, SMOOTHING);
        verticalAngle = lerp(verticalAngle, targetVerticalAngle, SMOOTHING);
        
        // Check if we've reached the target
        if (hasReachedTarget()) {
          if (targetReachedTime === 0) {
            // Just reached target, start timer
            targetReachedTime = millis();
          } else if (millis() - targetReachedTime >= POSITION_HOLD_TIME) {
            // We've held position for the required time
            // Switch back to searching state
            currentState = STATE.SEARCHING;
            noFaceFrameCount = 0; // Reset counter
            targetReachedTime = 0; // Reset timer
          }
        } else {
          // Still moving, reset timer
          targetReachedTime = 0;
        }
        break;
      
    case STATE.SCANNING:
      // Perform horizontal scanning while maintaining default vertical angle
      
      // Calculate horizontal position using sine wave
      const scanProgress = (millis() - scanStartTime) * SCAN_SPEED;
      const scanPosition = sin(scanProgress);
      
      // Map sine wave (-1 to 1) to horizontal angle range
      targetHorizontalAngle = map(scanPosition, -1, 1, HORIZONTAL_MIN, HORIZONTAL_MAX);
      
      // Move back to default vertical position
      targetVerticalAngle = 45;
      
      // Apply smooth movement
      horizontalAngle = lerp(horizontalAngle, targetHorizontalAngle, SMOOTHING * 0.5); // Slower movement
      verticalAngle = lerp(verticalAngle, targetVerticalAngle, SMOOTHING * 0.5);
      
      // If we detect a face, go back to searching
      if (faces.length > 0) {
        currentState = STATE.SEARCHING;
        noFaceFrameCount = 0;
      }
      break;
  }
  
  // Ensure angles stay within limits
  horizontalAngle = constrain(horizontalAngle, HORIZONTAL_MIN, HORIZONTAL_MAX);
  verticalAngle = constrain(verticalAngle, VERTICAL_MIN, VERTICAL_MAX);
  
  // Send current position to servos
  sendPositionsToArduino(horizontalAngle, verticalAngle);
  
  // Draw debug visualization
  drawDebugInfo();
}

// Check if camera has reached target position
function hasReachedTarget() {
  const hDiff = abs(horizontalAngle - targetHorizontalAngle);
  const vDiff = abs(verticalAngle - targetVerticalAngle);
  return hDiff < TARGET_REACHED_THRESHOLD && vDiff < TARGET_REACHED_THRESHOLD;
}


function calculateAvoidancePosition(faceX, faceY, faceSize) {
  // Calculate center of screen
  const centerX = width / 2;
  const centerY = height / 2;
  
  // Calculate vector from center to face
  const dirX = faceX - centerX;
  const dirY = faceY - centerY;
  
  // Determine horizontal movement strategy
  // If face is on the left, move all the way right; if on right, move all the way left
  if (dirX < 0) {
    // Face on left side, move to far right
    targetHorizontalAngle = HORIZONTAL_MAX;
  } else {
    // Face on right side, move to far left
    targetHorizontalAngle = HORIZONTAL_MIN;
  }
  
  // Determine vertical movement strategy
  // If face is above center, look down; if below center, look up
  if (dirY < 0) {
    // Face above center, look down
    targetVerticalAngle = VERTICAL_MIN;
  } else {
    // Face below center, look up
    targetVerticalAngle = VERTICAL_MAX;
  }
  
  // Special case: if face is near vertical extreme, flip to opposite extreme
  if (verticalAngle >= VERTICAL_MAX - 10) {
    // Already looking up, immediately look down instead
    targetVerticalAngle = VERTICAL_MIN;
  } else if (verticalAngle <= VERTICAL_MIN + 10) {
    // Already looking down, immediately look up instead
    targetVerticalAngle = VERTICAL_MAX;
  }
  
  // Special case: if face is near horizontal extreme, flip to opposite extreme
  if (horizontalAngle >= HORIZONTAL_MAX - 20) {
    // Already at right extreme, move to left instead
    targetHorizontalAngle = HORIZONTAL_MIN;
  } else if (horizontalAngle <= HORIZONTAL_MIN + 20) {
    // Already at left extreme, move to right instead
    targetHorizontalAngle = HORIZONTAL_MAX;
  }
  
  console.log(`Avoiding to H:${targetHorizontalAngle} V:${targetVerticalAngle}`);
}

function drawDebugInfo() {
  // Display info text
  fill(255);
  noStroke();
  textSize(16);
  text(`State: ${currentState}`, 20, 20);
  text(`Horizontal: ${Math.round(horizontalAngle)}° (target: ${Math.round(targetHorizontalAngle)}°)`, 20, 40);
  text(`Vertical: ${Math.round(verticalAngle)}° (target: ${Math.round(targetVerticalAngle)}°)`, 20, 60);
  text(`Faces: ${faces.length}`, 20, 80);
  
  // Draw serial connection status
  fill(serialConnected ? color(0, 255, 0) : color(255, 0, 0));
  text(serialConnected ? "Serial Connected" : "Serial Disconnected", width - 150, 20);
  
  // Draw center zone 
  noFill();
  stroke(255, 0, 0, 100);
  strokeWeight(1);
  rectMode(CENTER);
  rect(width/2, height/2, 200, 150);
  rectMode(CORNER);
  
  // Draw camera direction indicator
  stroke(0, 255, 0);
  noFill();
  ellipse(width/2, height/2, 50, 50);
  line(width/2, height/2, 
       width/2 + cos(radians(map(horizontalAngle, HORIZONTAL_MIN, HORIZONTAL_MAX, 150, 30))) * 100,
       height/2 - sin(radians(map(verticalAngle, VERTICAL_MIN, VERTICAL_MAX, 0, 45))) * 100);
  
  // If in AVOIDING state, draw the face that was detected
  if (currentState === STATE.AVOIDING && faces.length > 0) {
    let face = faces[0];
    let bbox = face.box;
    
    noFill();
    stroke(255, 255, 0);
    strokeWeight(2);
    rect(bbox.xMin, bbox.yMin, bbox.width, bbox.height);
  }
}
