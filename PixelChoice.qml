import QtQuick
import qs.Commons

// A labelled row of chips where one option is selected.
Row {
  id: choice

  property string label: ""
  property var options: []           // [[value, label], ...]
  property string value: ""
  property color accent: Color.accent
  property color fg: Color.popups.text
  property color bg: Color.popups.background
  property color dim: Qt.darker(Color.popups.text, 1.6)
  signal picked(string v)

  spacing: 6

  Text {
    width: 56
    anchors.verticalCenter: parent.verticalCenter
    text: choice.label
    textFormat: Text.PlainText
    color: choice.dim
    font.family: Style.font.family
    font.pixelSize: Style.font.caption
  }
  Repeater {
    model: choice.options
    delegate: PixelChip {
      required property var modelData
      text: modelData[1]
      selected: choice.value === modelData[0]
      accent: choice.accent
      fg: choice.fg
      bg: choice.bg
      onPicked: choice.picked(modelData[0])
    }
  }
}
