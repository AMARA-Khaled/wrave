import os

theme_dir = r'C:\Users\walid\Desktop\weed\wrave\src\brave\app\theme\brave'

for filename in os.listdir(theme_dir):
    if filename.startswith('BRANDING'):
        path = os.path.join(theme_dir, filename)
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Replace product names strictly with Wrave
        content = content.replace('PRODUCT_FULLNAME=Brave Browser Development', 'PRODUCT_FULLNAME=Wrave')
        content = content.replace('PRODUCT_FULLNAME=Brave Browser Beta', 'PRODUCT_FULLNAME=Wrave')
        content = content.replace('PRODUCT_FULLNAME=Brave Browser Dev', 'PRODUCT_FULLNAME=Wrave')
        content = content.replace('PRODUCT_FULLNAME=Brave Browser Nightly', 'PRODUCT_FULLNAME=Wrave')
        content = content.replace('PRODUCT_FULLNAME=Brave Browser', 'PRODUCT_FULLNAME=Wrave')
        content = content.replace('PRODUCT_FULLNAME=Wrave Browser', 'PRODUCT_FULLNAME=Wrave')

        content = content.replace('PRODUCT_SHORTNAME=Brave Development', 'PRODUCT_SHORTNAME=Wrave')
        content = content.replace('PRODUCT_SHORTNAME=Brave Beta', 'PRODUCT_SHORTNAME=Wrave')
        content = content.replace('PRODUCT_SHORTNAME=Brave Dev', 'PRODUCT_SHORTNAME=Wrave')
        content = content.replace('PRODUCT_SHORTNAME=Brave Nightly', 'PRODUCT_SHORTNAME=Wrave')
        content = content.replace('PRODUCT_SHORTNAME=Brave', 'PRODUCT_SHORTNAME=Wrave')

        content = content.replace('PRODUCT_INSTALLER_FULLNAME=Brave Installer', 'PRODUCT_INSTALLER_FULLNAME=Wrave')
        content = content.replace('PRODUCT_INSTALLER_FULLNAME=Wrave Installer', 'PRODUCT_INSTALLER_FULLNAME=Wrave')
        content = content.replace('PRODUCT_INSTALLER_SHORTNAME=Brave Installer', 'PRODUCT_INSTALLER_SHORTNAME=Wrave')
        content = content.replace('PRODUCT_INSTALLER_SHORTNAME=Wrave Installer', 'PRODUCT_INSTALLER_SHORTNAME=Wrave')

        content = content.replace('COMPANY_FULLNAME=Brave Software, Inc.', 'COMPANY_FULLNAME=Wrave, Inc.')
        content = content.replace('COMPANY_FULLNAME=Wrave Browser, Inc.', 'COMPANY_FULLNAME=Wrave, Inc.')
        content = content.replace('COMPANY_SHORTNAME=Brave Software', 'COMPANY_SHORTNAME=Wrave')
        content = content.replace('com.brave.Browser', 'com.wrave.app')

        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'Updated {filename} -> PRODUCT_FULLNAME=Wrave')
