import base64
import os

with open(r'C:\Users\walid\Desktop\weed\wrave\weedex_icon_256.png', 'rb') as f:
    b64 = base64.b64encode(f.read()).decode('utf-8')

svg_content = f'''<svg viewBox="0 0 256 256" width="256" height="256" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#22c55e" flood-opacity="0.4"/>
    </filter>
  </defs>
  <g filter="url(#glow)">
    <image href="data:image/png;base64,{b64}" x="0" y="0" width="256" height="256" preserveAspectRatio="xMidYMid meet"/>
  </g>
</svg>'''

out_path = r'C:\Users\walid\Desktop\weed\wrave\src\wrave-branding\product_logo.svg'
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(svg_content)
print('Generated', out_path)

lion_replacement = f'''<svg width="128" height="128" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <style>
    @keyframes wrave-bounce {{ to {{ transform: translateY(4px); }} }}
  </style>
  <g style="animation: wrave-bounce 1.2s infinite alternate ease-in-out;">
    <image href="data:image/png;base64,{b64}" x="0" y="0" width="256" height="256"/>
  </g>
</svg>'''

lion_path = r'C:\Users\walid\Desktop\weed\wrave\src\wrave-branding\lion_logo.svg'
with open(lion_path, 'w', encoding='utf-8') as f:
    f.write(lion_replacement)
print('Generated', lion_path)
