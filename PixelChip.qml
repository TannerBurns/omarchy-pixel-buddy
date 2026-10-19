import QtQuick
import qs.Commons

// A pixel-styled toggle chip for the menus.
Item {
  id: chip

  property string text: ""
  property bool selected: false
  property color accent: Color.accent
  property color fg: Color.popups.text
  property color bg: Color.popups.background
  signal picked()

  width: chipLabel.implicitWidth + 16
  height: chipLabel.implicitHeight + 8

  Rectangle {
    anchors.fill: parent
    color: chip.selected || chipMouse.containsMouse ? chip.accent : "transparent"
    border.color: chip.accent
    border.width: 2
  }
  Text {
    id: chipLabel
    anchors.centerIn: parent
    text: chip.text
    textFormat: Text.PlainText
    color: chip.selected || chipMouse.containsMouse ? chip.bg : chip.fg
    font.family: Style.font.family
    font.pixelSize: Style.font.bodySmall
  }
  MouseArea {
    id: chipMouse
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onClicked: chip.picked()
  }
}
