#include <Servo.h>

Servo servoH;  // Horizontal servo
Servo servoV;  // Vertical servo

String inputString = "";
boolean stringComplete = false;

void setup() {
  Serial.begin(9600);
  servoH.attach(9);  // Attach horizontal servo to pin 9
  servoV.attach(11); // Attach vertical servo to pin 10
  
  // Initialize to neutral positions
  servoH.write(180);
  servoV.write(0);
  
  inputString.reserve(20);
}

void loop() {
  if (stringComplete) {
    // Parse H and V values from the string like "H90V45"
    int hIndex = inputString.indexOf('H');
    int vIndex = inputString.indexOf('V');
    
    if (hIndex >= 0 && vIndex >= 0) {
      int hValue = inputString.substring(hIndex + 1, vIndex).toInt();
      int vValue = inputString.substring(vIndex + 1).toInt();
      
      // Set servo positions
      servoH.write(hValue);
      servoV.write(vValue);
    }
    
    // Clear the string for new input
    inputString = "";
    stringComplete = false;
  }
}

void serialEvent() {
  while (Serial.available()) {
    char inChar = (char)Serial.read();
    inputString += inChar;
    
    if (inChar == '\n') {
      stringComplete = true;
    }
  }
}
