# Google sheets
import gspread
import logging

from oauth2client.service_account import ServiceAccountCredentials
# Telegram
from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, ContextTypes, filters
from telegram.ext import CommandHandler
from telegram import ReplyKeyboardMarkup

from dataclasses import dataclass

from apscheduler.schedulers.background import BackgroundScheduler
import calendar
from datetime import datetime, timedelta, time
from apscheduler.schedulers.background import BackgroundScheduler

from pytz import timezone
import asyncio
import os

from gspread_formatting import set_frozen
from gspread.exceptions import APIError

from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

@dataclass
class User:
    nombre: str
    telegram_id: str


# Global variables
ActiveUsers = {}
Questions = {}
user_data = {}

async def send_questions_to_user(user, update, context, preguntas):
    try:
        # Enviar un mensaje de saludo primero
        await context.bot.send_message(
            chat_id=update.message.chat_id,
            text=f"¡Hola {user.nombre}! 👋\n\nComencemos con unas preguntas de seguimiento:"
        )
        
        await context.bot.send_message(
            chat_id=update.message.chat_id,
            text=f"Empezamos con los perimetros, escribe a continuación en cm las medidas de los siguientes perimetros:"
        )
        
        
        # Es necesario actualizar ele stado de dicho usuario.
        if user.telegram_id in user_data:
            user_data[user.telegram_id]["step"] = "ask_questions"
            
        else:
            user_data[user.telegram_id] = {
                "name": user.nombre,
                "step": "ask_questions",  # se define cuando inicie el flujo
                "current_q": 0,
                "answers": []
            }

        # Enviar pregunta inicial al usuario
        await context.bot.send_message(
                chat_id=update.message.chat_id,
                text=preguntas[0]
        )

    except Exception as e:
        print(f"Error al enviar mensajes a {user.telegram_id}: {e}")

async def send_questions_to_all_users(context):
    # Crear una lista de tareas asíncronas para cada usuario
    tasks = [send_questions_to_user(user, context, Questions) for user in ActiveUsers]

    # Ejecutar todas las tareas de manera concurrente
    await asyncio.gather(*tasks)

def schedule_weekly_tasks(application):
    job_queue = application.job_queue

    # Usamos el job_queue de telegram para programar una tarea
    job_queue = application.job_queue

    def callback_wrapper(context):
        # Solo ejecutar si hoy es domingo
        if datetime.today().weekday() == 6:  # domingo
            send_questions_to_all_users(context)

    # Programar para que se ejecute todos los días a las 10:00
    job_queue.run_daily(
        callback=callback_wrapper,
        time=time(hour=10, minute=0),
        name="weekly_questions"
    )

def readQuestions():
# Define el scope (alcances)
    scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']

    # Usa el archivo de la cuenta de servicio
    creds = ServiceAccountCredentials.from_json_keyfile_name('credentials.json', scope)

    # Autoriza cliente gspread
    client = gspread.authorize(creds)

    # Abre el archivo por nombre (debes haberlo compartido con el correo de la cuenta de servicio)
    sheet = client.open("Preguntas").sheet1

    # Lee preguntas de la primera columna
    preguntas = sheet.col_values(1)
    preguntas.append("Por ultimo, adjunta unas fotos para evaluar tu composición corporal (Frente, Perfil izquierdo, Perfil derecho y espalda)! Si no lo deseas, escribe NO")
    return preguntas

def readActiveUsers():
    scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
    creds = ServiceAccountCredentials.from_json_keyfile_name('credentials.json', scope)
    client = gspread.authorize(creds)
    sheet = client.open("Users").sheet1

    records = sheet.get_all_records()  # [{'Nombre': ..., 'Usuario': ...}, ...]

    users = []
    for record in records:
        user = User(nombre=record['Nombre'], telegram_id=str(record['Usuario']))
        users.append(user)

    return users

async def start(update, context):
    telegram_id = str(update.message.from_user.name)
    users = readActiveUsers()

    found_user = next((u for u in users if u.telegram_id == telegram_id), None)

    if found_user:
        await context.bot.send_message(chat_id=update.message.chat_id,
                                text=f"¡Hola {found_user.nombre}! 👋\n\n"
        "Bienvenido a tu espacio personalizado de seguimiento nutricional. 🥦💪\n"
        "Aquí podrás compartir cómo te estás sintiendo, cómo vas con tu plan y recibir recordatorios importantes.\n\n"
        "Estoy aquí para acompañarte en cada paso del camino hacia tu mejor versión. ¡Vamos a por ello! 🚀")
    else:
        context.bot.send_message(chat_id=update.message.chat_id,
                                 text="Hable con Manuel Ángel Trenas, su usuario no está habilitado.")

async def handle_text(update, context):
    user_id = update.message.from_user.name
    user_name = update.message.from_user.full_name

    text = update.message.text

    ActiveUsers = readActiveUsers()
    for user in ActiveUsers:
        if user.telegram_id not in user_data:
            user_data[user.telegram_id] = {
                "name": user.nombre,
                "step": None,  # se define cuando inicie el flujo
                "current_q": 0,
                "answers": []
            }

    # Verificamos si el usuario está autorizado
    if user_id not in user_data:
        context.bot.send_message(chat_id=update.message.chat_id, text="Tu usuario no está habilitado.")
        return

    # Flujo de recolección de datos
    if user_data[user_id]["step"] == None:
        user_data[user_id]["name"] = user_name
        user_data[user_id]["answers"] = []
        user_data[user_id]["current_q"] = 0
        await context.bot.send_message(chat_id=update.message.chat_id, text=f"¡Hola {user_name}! ¿Qué tal estás? Si tienes alguna duda no dudes en contactar conmigo via Whatsapp o mediante llamada telefónica.")
    
    elif user_data[user_id]["step"] == "ask_questions":
        idx = user_data[user_id]["current_q"]

        # Guardamos la respuesta
        user_data[user_id]["answers"].append(text)
    
        # ¿Es la última pregunta (la de las fotos)?
        if idx == len(Questions) - 1 and text.strip().upper() == "NO":
            # Guardar datos y cerrar flujo
            await save_user_data(user_id)
            user_data[user_id]["step"] = None
            user_data[user_id]["current_q"] = 0
            user_data[user_id]["answers"] = []  # <-- limpia respuestas ya guardadas

            await context.bot.send_message(
                chat_id=update.message.chat_id,
                text="✅ Perfecto, no se enviarán fotos. Revisión guardada correctamente."
            )
            return
    
        # Si no, seguimos normalmente
        user_data[user_id]["current_q"] += 1
    if user_data[user_id]["step"] == "ask_questions":
        await ask_next_question(update, context)



async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.message.from_user
    uid = f"@{user.username}"
    
    user_id = update.message.from_user.name
    user_name = update.message.from_user.full_name

    ActiveUsers = readActiveUsers()
    for userAux in ActiveUsers:
        if userAux.telegram_id not in user_data:
            user_data[userAux.telegram_id] = {
                "name": userAux.nombre,
                "step": None,  # se define cuando inicie el flujo
                "current_q": 0,
                "answers": []
            }

    # Verificamos si el usuario está autorizado
    if user_id not in user_data:
        context.bot.send_message(chat_id=update.message.chat_id, text="Tu usuario no está habilitado.")
        return

    if user_data[user_id]["step"] in ["ask_questions", "upload_photos"]:
        await save_user_data(user_id)
        user_data[user_id]["step"] = None
        # Descargamos el archivo (la versión de mayor resolución está al final)
        photo = update.message.photo[-1]
        tg_file = await context.bot.get_file(photo.file_id)
        # Asegúrate de crear la carpeta una sola vez
        os.makedirs("tmp", exist_ok=True)

        # Construye la ruta dentro de ./tmp, no en la raíz del disco
        local_path = os.path.join("tmp", f"{photo.file_id}.jpg")
        await tg_file.download_to_drive(local_path)

        scope = [
        'https://spreadsheets.google.com/feeds',
        'https://www.googleapis.com/auth/drive'
        ]
        creds = ServiceAccountCredentials.from_json_keyfile_name('credentials.json', scope)

        # 4) Subir a Google Drive usando la API oficial
        drive_service = build('drive', 'v3', credentials=creds)
        # 1. Crear estructura: [root]/Fotos/[nombre]
        root_folder = "1G-QgvfDD-dqMPzjuaA71ii7t6aWn_prX"

        # Asegúrate de usar el nombre real, no el @usuario
        nombre_usuario = user_data[uid]["name"]
        user_folder = ensure_drive_folder(drive_service, root_folder, nombre_usuario)

        # 2. Subir dentro de la carpeta del usuario
        file_metadata = {
            'name': os.path.basename(local_path),
            'parents': [user_folder]
        }
        media = MediaFileUpload(local_path, mimetype='image/jpeg')
        file = drive_service.files().create(
            body=file_metadata,
            media_body=media,
            fields='id, webContentLink'
        ).execute()
        try:
            media._fd.close()
        except Exception:
            pass
        # Hacerlo público:
        drive_service.permissions().create(
            fileId=file['id'],
            body={'type': 'anyone', 'role': 'reader'}
        ).execute()
        public_url = file['webContentLink']

        # 5) Adjuntar en tu Google Sheet la fórmula =IMAGE(...)
        client = gspread.authorize(creds)
        #sheet = client.open("Revisiones").sheet1
        sheet = client.open("Revisiones").worksheet("Revision")
        nombre = user_data[uid]["name"]
        fecha = datetime.now().strftime("%Y-%m-%d")
        pregunta = "Imagen adjunta"
        formula = f'=IMAGE("{public_url}"; 4; {photo.height}; {photo.width})'

        # Insertar la fila completa: Nombre | Fecha | @usuario | Pregunta | Imagen
        row = [nombre, fecha, uid, pregunta, formula]
        sheet.append_row(row, value_input_option='USER_ENTERED')

        # 6) Limpiar y notificar
        os.remove(local_path)
        user_data[uid]["step"] = None
        user_data[uid]["current_q"] = 0
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text="✅ ¡Imagen recibida y almacenada correctamente!"
        )
    else:
        # Descargamos el archivo (la versión de mayor resolución está al final)
        photo = update.message.photo[-1]
        tg_file = await context.bot.get_file(photo.file_id)
        # Asegúrate de crear la carpeta una sola vez
        os.makedirs("tmp", exist_ok=True)

        # Construye la ruta dentro de ./tmp, no en la raíz del disco
        local_path = os.path.join("tmp", f"{photo.file_id}.jpg")
        await tg_file.download_to_drive(local_path)

        scope = [
        'https://spreadsheets.google.com/feeds',
        'https://www.googleapis.com/auth/drive'
        ]
        creds = ServiceAccountCredentials.from_json_keyfile_name('credentials.json', scope)

        # 4) Subir a Google Drive usando la API oficial
        drive_service = build('drive', 'v3', credentials=creds)
        folder_id = "1G-QgvfDD-dqMPzjuaA71ii7t6aWn_prX"  # tu carpeta Drive
        file_metadata = {
            'name': os.path.basename(local_path),
            'parents': [folder_id]
        }
        media = MediaFileUpload(local_path, mimetype='image/jpeg')
        file = drive_service.files().create(
            body=file_metadata,
            media_body=media,
            fields='id, webContentLink'
        ).execute()
        try:
            media._fd.close()
        except Exception:
            pass
        # Hacerlo público:
        drive_service.permissions().create(
            fileId=file['id'],
            body={'type': 'anyone', 'role': 'reader'}
        ).execute()
        public_url = file['webContentLink']

        # 5) Adjuntar en tu Google Sheet la fórmula =IMAGE(...)
        client = gspread.authorize(creds)
        #sheet = client.open("Revisiones").sheet1
        sheet = client.open("Revisiones").worksheet("Revision")
        nombre = user_data[uid]["name"]
        fecha = datetime.now().strftime("%Y-%m-%d")
        pregunta = "Imagen adjunta"
        formula = f'=IMAGE("{public_url}"; 4; {photo.height}; {photo.width})'

        # Insertar la fila completa: Nombre | Fecha | @usuario | Pregunta | Imagen
        row = [nombre, fecha, uid, pregunta, formula]
        sheet.append_row(row, value_input_option='USER_ENTERED')

        # 6) Limpiar y notificar
        os.remove(local_path)
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text="✅ ¡Imagen recibida y almacenada correctamente!"
        )

async def instrucciones_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    mensaje = (
        "ℹ️ *Instrucciones de uso*\n\n"
        "Este bot forma parte de tu sistema de seguimiento deportivo y nutricional. "
        "Su objetivo es recopilar, de forma estructurada y continua, la información de cada atleta "
        "para construir un historial completo de evolución.\n\n"
        "Gracias a estos datos, es posible realizar análisis y representaciones gráficas que permiten "
        "evaluar el progreso a lo largo del tiempo y tomar decisiones más precisas para optimizar los resultados.\n\n"
        "📅 *Frecuencia del seguimiento*\n"
        "El cuestionario se lanzará automáticamente una vez por semana.\n"
        "También puede iniciarse manualmente usando la opción correspondiente del bot.\n\n"
        "📝 *Cómo responder correctamente*\n"
        "• Responde cada pregunta con un solo mensaje.\n"
        "• No dividas una respuesta en varios mensajes.\n"
        "• Espera siempre a que el bot envíe la siguiente pregunta.\n\n"
        "Este funcionamiento es clave para que la información quede correctamente registrada.\n\n"
        "Gracias por tu colaboración."
    )

    await update.message.reply_text(mensaje, parse_mode="Markdown")
    

def ensure_drive_folder(service, parent_id, folder_name):
    # Buscar si ya existe la carpeta
    query = f"'{parent_id}' in parents and name = '{folder_name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    results = service.files().list(q=query, fields="files(id, name)").execute()
    folders = results.get("files", [])
    if folders:
        return folders[0]['id']
    
    # Si no existe, crearla
    file_metadata = {
        'name': folder_name,
        'mimeType': 'application/vnd.google-apps.folder',
        'parents': [parent_id]
    }
    folder = service.files().create(body=file_metadata, fields='id').execute()
    return folder.get('id')


async def ask_next_question(update, context):
    user_id = update.message.from_user.name
    idx = user_data[user_id]["current_q"]
    if idx < len(Questions):
        await context.bot.send_message(chat_id=update.message.chat_id, text=Questions[idx])
    else:
        await context.bot.send_message(chat_id=update.message.chat_id, text="Gracias por completar las preguntas!")
        user_data[user_id]["current_q"] = 0
        await save_user_data(user_id)

async def save_user_data(telegram_username):
    # Autenticación
    scope = [
        'https://spreadsheets.google.com/feeds',
        'https://www.googleapis.com/auth/drive'
    ]
    creds = ServiceAccountCredentials.from_json_keyfile_name('credentials.json', scope)
    client = gspread.authorize(creds)

    #sheet = client.open("Revisiones").sheet1
    sheet = client.open("Revisiones").worksheet("Revision")

    # 1) Encabezados
    headers = ["Nombre", "Fecha", "Telegram", "Pregunta", "Respuesta"]
    if sheet.row_values(1) != headers:
        sheet.clear()
        sheet.append_row(headers)
        # Intentamos congelar la primera fila, pero si falla (solo 1 fila), lo ignoramos
        try:
            set_frozen(sheet, rows=1)
        except APIError as e:
            # Esto evita el “You can't freeze all visible rows” sin detener la ejecución
            if "freeze all visible rows" not in str(e).lower():
                raise
        

    # 2) Preparar datos
    nombre = user_data[telegram_username]["name"]
    respuestas = user_data[telegram_username]["answers"]
    fecha_hoy = datetime.now().strftime("%Y-%m-%d")

    # 3) Insertar una fila por cada respuesta
    for idx, respuesta in enumerate(respuestas):
        pregunta = Questions[idx] if idx < len(Questions) else f"Pregunta {idx+1}"
        row = [nombre, fecha_hoy, telegram_username, pregunta, respuesta]
        sheet.append_row(row)

# Callback para /Revision
async def revision_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("🔄 Lanzando revisión de seguimiento ahora mismo…")
    # Reusar la función que ya programa la tarea mensual
    #Primero buscamos al usuario dentro de la lista de usuarios habilitados
    ActiveUsers = readActiveUsers()

    found_user = next((u for u in ActiveUsers if u.telegram_id == update.message.from_user.name), None)

    if found_user:
        await send_questions_to_user(found_user, update, context, Questions)
    else:
        await context.bot.send_message(
            chat_id=update.message.chat_id,
            text="No estás en la lista de usuarios activos."
        )

async def info_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    mensaje = (
        "👋 *Bienvenido/a a tu asistente de revisiones nutricionales*\n\n"
        "Este bot ha sido diseñado para facilitar el proceso de seguimiento y revisión periódica de tu evolución. "
        "A través de preguntas estructuradas, podrás dejar constancia de cómo te encuentras y subir imágenes si lo deseas 📸.\n\n"
        "Toda la información que compartes se almacena automáticamente en una base de datos privada, lo que permite llevar un "
        "registro detallado de tus progresos a lo largo del tiempo. Gracias a esto, se pueden realizar análisis que nos ayudarán "
        "a tomar mejores decisiones y optimizar tu rendimiento 💪📊.\n\n"
        "Recuerda que, si tienes cualquier duda o necesitas hablar directamente, puedes contactar con *Manuel Ángel Trenas* "
        "a través de los medios de contacto que te han sido proporcionados. ¡Estoy aquí para ayudarte, pero Manuel siempre tendrá la última palabra! 😉\n\n"
        "_Gracias por tu compromiso y dedicación._"
    )

    await update.message.reply_text(mensaje, parse_mode="Markdown")

async def fotos_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.message.from_user.name
    user_name = update.message.from_user.full_name

    # Asegurar usuarios activos en memoria
    ActiveUsers = readActiveUsers()
    for user in ActiveUsers:
        if user.telegram_id not in user_data:
            user_data[user.telegram_id] = {
                "name": user.nombre,
                "step": None,
                "current_q": 0,
                "answers": []
            }

    # Verificar autorización
    if user_id not in user_data:
        await update.message.reply_text(
            "❌ Tu usuario no está habilitado para subir fotos."
        )
        return

    # Activar modo subida manual de fotos
    user_data[user_id]["step"] = "upload_photos"
    user_data[user_id]["current_q"] = None
    user_data[user_id]["name"] = user_name

    await update.message.reply_text(
        "📸 *Subida manual de fotos activada*\n\n"
        "Puedes enviar ahora las fotos de la revisión.\n"
        "Envía las imágenes una a una.\n\n"
        "Cuando termines, simplemente deja de enviar fotos.",
        parse_mode="Markdown"
    )

async def status_logger():
    while True:
        print("⌛ Aplicación en ejecución. Esperando mensajes de Telegram...")
        await asyncio.sleep(10)

async def post_init(application):
    asyncio.create_task(status_logger())

def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

    app = ApplicationBuilder().token("7718801957:AAEiQmiAqhWhMuZQ0rOR1VbU5ZUph24_E7E").post_init(post_init).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    app.add_handler(CommandHandler("revision", revision_command))
    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))
    app.add_handler(CommandHandler("info", info_command))
    app.add_handler(CommandHandler("instrucciones", instrucciones_command))
    app.add_handler(CommandHandler("fotos", fotos_command))

    # Programar tarea mensual usando el scheduler
    schedule_weekly_tasks(app)

    logging.info("✅ Bot iniciado correctamente.")

    app.run_polling()

if __name__ == '__main__':
    # Las preguntas deben cargarse antes de lanzar el bot
    Questions = readQuestions()
    #schedule_monthly_tasks()
    main()


