import os

android_theme = r'C:\Users\walid\Desktop\weed\wrave\src\brave\app\theme\brave\android'

for root, dirs, files in os.walk(android_theme):
    for f in files:
        if f == 'channel_constants.xml':
            path = os.path.join(root, f)
            with open(path, 'r', encoding='utf-8') as file:
                c = file.read()
            c = c.replace('>Brave - Debug<', '>Wrave<')
            c = c.replace('>Brave - Beta<', '>Wrave<')
            c = c.replace('>Brave - Dev<', '>Wrave<')
            c = c.replace('>Brave - Nightly<', '>Wrave<')
            c = c.replace('>Brave<', '>Wrave<')
            c = c.replace('>Brave bookmarks<', '>Wrave bookmarks<')
            c = c.replace('>Brave search<', '>Wrave search<')
            c = c.replace('>Brave quick action search<', '>Wrave quick action search<')
            with open(path, 'w', encoding='utf-8') as file:
                file.write(c)
            print(f'Updated {path} -> app_name=Wrave')
