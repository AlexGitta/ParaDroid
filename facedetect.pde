import gab.opencv.*;
import processing.video.*;
import processing.serial.*;
import java.awt.*;

Capture cam;
OpenCV opencv;
Serial port;
int lastPosition = 90;  // Default middle position

// Face tracking with smoothing variables
Rectangle smoothedFace = new Rectangle(0, 0, 0, 0);
boolean faceDetected = false;
int framesSinceFaceDetected = 0;
final int FACE_MEMORY_FRAMES = 10; // Remember face for this many frames after it disappears
final float SMOOTHING_FACTOR = 0.2; // Smoothing factor

void setup() {
  size(640, 480);
  
  // Initialize camera
  String[] cameras = Capture.list();
  if (cameras.length == 0) {
    println("No cameras available!");
    exit();
  } else {
    println("Available cameras:");
    for (int i = 0; i < cameras.length; i++) {
      println(i + ": " + cameras[i]);
    }
    // Use the first camera in the list
    cam = new Capture(this, 640, 480, cameras[0]);
    cam.start();
  }
  
  // Initialize OpenCV
  opencv = new OpenCV(this, 640, 480);
  opencv.loadCascade(OpenCV.CASCADE_FRONTALFACE);
  
  // Initialize Serial communication with Arduino
  println("Available serial ports:");
  printArray(Serial.list());
  // Change the index below to match your Arduino port
  String portName = Serial.list()[0]; 
  port = new Serial(this, portName, 9600);
}

void draw() {
  // Check if new frame is available
  if (cam.available()) {
    cam.read();
    
    // Load the camera image into OpenCV
    opencv.loadImage(cam);
    
    // Draw the camera feed
    image(cam, 0, 0);
    
    // Detect faces
    Rectangle[] faces = opencv.detect();
    
    if (faces.length > 0) {
      // Face is detected in this frame
      framesSinceFaceDetected = 0;
      faceDetected = true;
      
      // Get the largest face (alternatively you could track based on position)
      Rectangle currentFace = getLargestFace(faces);
      
      // Apply smoothing to the face rectangle
      if (smoothedFace.width == 0 && smoothedFace.height == 0) {
        // First detection - initialize the smoothed face
        smoothedFace = new Rectangle(
          currentFace.x, 
          currentFace.y, 
          currentFace.width, 
          currentFace.height
        );
      } else {
        // Apply smoothing using linear interpolation
        smoothedFace.x = lerp1(smoothedFace.x, currentFace.x, SMOOTHING_FACTOR);
        smoothedFace.y = lerp1(smoothedFace.y, currentFace.y, SMOOTHING_FACTOR);
        smoothedFace.width = lerp1(smoothedFace.width, currentFace.width, SMOOTHING_FACTOR);
        smoothedFace.height = lerp1(smoothedFace.height, currentFace.height, SMOOTHING_FACTOR);
      }
      
      // Calculate the center X position of the smoothed face
      int faceX = (int)(smoothedFace.x + smoothedFace.width / 2);
      
      // Map the X position to a motor angle (0-180 for servo)
      int motorPosition = int(map(faceX, 0, width, 0, 180));
      
      // Smooth the motor movement as well
      motorPosition = (int)(motorPosition * SMOOTHING_FACTOR + lastPosition * (1 - SMOOTHING_FACTOR));
      lastPosition = motorPosition;
      
      // Send the position to Arduino
      port.write(motorPosition);
      
      // Display the position data
      displayInfo(faceX, motorPosition);
    } else {
      // No face detected in this frame
      framesSinceFaceDetected++;
      
      // Continue displaying and tracking the last known position for a while
      if (framesSinceFaceDetected <= FACE_MEMORY_FRAMES && faceDetected) {
        // Calculate the center X position of the remembered face
        int faceX = (int)(smoothedFace.x + smoothedFace.width / 2);
        
        // Map the X position to a motor angle
        int motorPosition = int(map(faceX, 0, width, 0, 180));
        
        // Smooth the motor movement
        motorPosition = (int)(motorPosition * SMOOTHING_FACTOR + lastPosition * (1 - SMOOTHING_FACTOR));
        lastPosition = motorPosition;
        
        // Send the position to Arduino
        port.write(motorPosition);
        
        // Display the position data
        displayInfo(faceX, motorPosition);
      } else if (framesSinceFaceDetected > FACE_MEMORY_FRAMES) {
        // Face is now officially lost
        faceDetected = false;
        fill(255, 0, 0);
        text("No face detected", 20, 20);
      }
    }
    
    // Draw the face rectangle if we have a face (detected or remembered)
    if (faceDetected) {
      noFill();
      
      // Calculate opacity based on how long the face has been gone
      int alpha = 255;
      if (framesSinceFaceDetected > 0) {
        alpha = (int)map(framesSinceFaceDetected, 0, FACE_MEMORY_FRAMES, 255, 50);
      }
      
      stroke(0, 255, 0, alpha);
      strokeWeight(3);
      
      // Draw the smoothed rectangle
      rect(
        smoothedFace.x, 
        smoothedFace.y, 
        smoothedFace.width, 
        smoothedFace.height
      );
    }
  }
}

// Find the largest face in the array of detected faces
Rectangle getLargestFace(Rectangle[] faces) {
  if (faces.length == 1) return faces[0];
  
  Rectangle largest = faces[0];
  int maxArea = largest.width * largest.height;
  
  for (int i = 1; i < faces.length; i++) {
    int area = faces[i].width * faces[i].height;
    if (area > maxArea) {
      maxArea = area;
      largest = faces[i];
    }
  }
  
  return largest;
}

// Linear interpolation helper function
int lerp1(float start, float end, float amount) {
  return Math.round(start + (end - start) * amount);
}

// Display tracking information on screen
void displayInfo(int faceX, int motorPosition) {
  fill(255, 0, 0);
  text("Face X: " + faceX + " | Motor angle: " + motorPosition, 20, 20);
  
  if (framesSinceFaceDetected > 0) {
    text("Face memory: Frame " + framesSinceFaceDetected + "/" + FACE_MEMORY_FRAMES, 20, 40);
  }
}
