import os
import shutil

branding_src = r'C:\Users\walid\Desktop\weed\wrave\src\wrave-branding'
brave_dir = r'C:\Users\walid\Desktop\weed\wrave\src\brave'

theme_dir = os.path.join(brave_dir, 'app', 'theme', 'brave')
theme_win_dir = os.path.join(theme_dir, 'win')
welcome_img_dir = os.path.join(brave_dir, 'components', 'brave_welcome_ui', 'components', 'images')

# Copy ICO files
shutil.copy2(os.path.join(branding_src, 'wrave.ico'), os.path.join(theme_win_dir, 'brave.ico'))
shutil.copy2(os.path.join(branding_src, 'wrave.ico'), os.path.join(theme_win_dir, 'brave_development.ico'))
print('Updated brave.ico and brave_development.ico')

# Copy PNG files
for s in [22, 24, 48, 64, 128, 256]:
    src_png = os.path.join(branding_src, f'product_logo_{s}.png')
    dst_png = os.path.join(theme_dir, f'product_logo_{s}.png')
    if os.path.exists(src_png):
        shutil.copy2(src_png, dst_png)
        print(f'Updated product_logo_{s}.png')

# Copy SVGs
shutil.copy2(os.path.join(branding_src, 'product_logo.svg'), os.path.join(theme_dir, 'product_logo.svg'))
shutil.copy2(os.path.join(branding_src, 'lion_logo.svg'), os.path.join(welcome_img_dir, 'lion_logo.svg'))
print('Updated product_logo.svg and lion_logo.svg')

# Update BRANDING file
branding_path = os.path.join(theme_dir, 'BRANDING')
with open(branding_path, 'r', encoding='utf-8') as f:
    branding_content = f.read()

branding_content = branding_content.replace('COMPANY_FULLNAME=Brave Software, Inc.', 'COMPANY_FULLNAME=Wrave Browser, Inc.')
branding_content = branding_content.replace('COMPANY_SHORTNAME=Brave Software', 'COMPANY_SHORTNAME=Wrave')
branding_content = branding_content.replace('PRODUCT_FULLNAME=Brave Browser', 'PRODUCT_FULLNAME=Wrave Browser')
branding_content = branding_content.replace('PRODUCT_SHORTNAME=Brave', 'PRODUCT_SHORTNAME=Wrave')
branding_content = branding_content.replace('PRODUCT_INSTALLER_FULLNAME=Brave Installer', 'PRODUCT_INSTALLER_FULLNAME=Wrave Installer')
branding_content = branding_content.replace('PRODUCT_INSTALLER_SHORTNAME=Brave Installer', 'PRODUCT_INSTALLER_SHORTNAME=Wrave Installer')
branding_content = branding_content.replace('MAC_BUNDLE_ID=com.brave.Browser', 'MAC_BUNDLE_ID=com.wrave.Browser')

with open(branding_path, 'w', encoding='utf-8') as f:
    f.write(branding_content)
print('Updated BRANDING config to Wrave Browser')
