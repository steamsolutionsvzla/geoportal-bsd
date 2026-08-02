import bcrypt
password_plana = "cs SteamAdmin123"
hashed = bcrypt.hashpw(password_plana.encode('utf-8'), bcrypt.gensalt())
print(hashed.decode('utf-8'))
